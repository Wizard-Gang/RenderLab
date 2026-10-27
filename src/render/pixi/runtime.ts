// The PixiJS v8 runtime behind the renderer-neutral RendererRuntime, on WebGL2 (RLDR-003) or WebGPU (RLDR-004).
// Scenes arrive as the core model and change through atomic deltas; PixiJS objects never leave src/render/.
import { BufferImageSource, Container, Texture } from "pixi.js";
import {
  acceptSnapshot, BackendSelectionError, checkViewport, computeView, ContractError, emptyDiagnostics, Failures,
  LifecycleError, maxTextureEdge, planBackends, RendererLifecycle, SceneStore, selectBackend, SMOOTH_SNAPPED,
  type ActiveBackend, type BackendAttempt, type CameraView, type Capabilities, type PixelPolicy, type PresentationSnapshot,
  type RecoveryEvent,
  type RendererBackend, type RendererDiagnostics, type RendererRuntime, type ResourceDescriptor, type ResourceId,
  type SceneDefinition, type SceneDelta, type SceneDirty, type Viewport,
} from "../../core";
import { probeCapabilities } from "../backends/probe";
import type { BackendSettings, StartedBackend } from "../backends/started";
import { UnsupportedSceneError } from "../errors";
import { checkTexturePixels, MAX_TEXTURE_EDGE, premultiplied, type TexturePixels, type TextureProvider } from "../textures";
import type { LoadedTileset } from "../terrain/chunks";
import { tilesetProblems } from "../terrain/geometry";
import { DEFAULT_TERRAIN, terrainSettingsProblems, type TerrainSettings } from "../terrain/residency";
import { countDrawCalls } from "./draw-calls";
import { refusals } from "./refusals";
import { PixiSceneGraph, unsupportedObjects } from "./scene-graph";

export interface PixiRuntimeOptions {
  /** The element the canvas is appended to. */
  readonly container: HTMLElement;
  readonly viewport: Viewport;
  readonly textures: TextureProvider;
  /** The clear colour behind every layer, 0xRRGGBB. */
  readonly background: number;
  /** `auto` (the default) tries `autoPreference` first and the other backend as a fallback; an explicit one never falls back. */
  readonly backend?: RendererBackend;
  /** The backend `auto` tries first. Only a governed change moves the default off WebGL2 (specification §6.1). */
  readonly autoPreference?: ActiveBackend;
  /** Capabilities probed in advance; the runtime probes them itself when omitted. */
  readonly capabilities?: Capabilities;
  /** How the camera meets the device pixel grid; smooth with a snapped origin by default (specification §10). */
  readonly pixelPolicy?: PixelPolicy;
  /** Terrain preload margin and chunk budget; `DEFAULT_TERRAIN` where omitted (specification §12.4, §15.2). */
  readonly terrain?: Partial<TerrainSettings>;
}

interface TextureEntry {
  readonly texture: Texture;
  readonly bytes: number;
}

interface TilesetEntry {
  readonly loaded: LoadedTileset;
  readonly pages: readonly TextureEntry[];
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
// Each backend's PixiJS renderer loads only when that backend is chosen, so a page downloads one renderer, not both.
const START: Record<ActiveBackend, (settings: BackendSettings) => Promise<StartedBackend>> = {
  webgl2: async (settings) => (await import("../backends/webgl2")).startWebGL2(settings),
  webgpu: async (settings) => (await import("../backends/webgpu")).startWebGPU(settings),
};

function createTexture(pixels: TexturePixels): TextureEntry {
  const source = new BufferImageSource({
    resource: premultiplied(pixels.rgba), width: pixels.width, height: pixels.height, format: "rgba8unorm",
    alphaMode: "premultiplied-alpha", scaleMode: pixels.filtering, autoGenerateMipmaps: false,
  });
  return { texture: new Texture({ source }), bytes: pixels.width * pixels.height * 4 };
}

async function loadTileset(provider: TextureProvider, resource: ResourceDescriptor, maxEdge: number): Promise<TilesetEntry> {
  if (!provider.tileset) throw new UnsupportedSceneError([`tileset ${resource.id}: the texture provider supplies no tilesets`]);
  const atlas = await provider.tileset(resource);
  const problems = tilesetProblems(atlas);
  if (problems.length) throw new ContractError(`tileset ${resource.id}`, problems);
  const pages = atlas.pages.map((page, index) => createTexture(checkTexturePixels(`${resource.id} page ${index}`, page, maxEdge)));
  const regions = new Map(atlas.regions.map((region) => [region.id, region]));
  return { loaded: { textures: pages.map((page) => page.texture), regions }, pages };
}

const releaseTileset = (entry: TilesetEntry) => {
  for (const page of entry.pages) page.texture.destroy(true);
};

export class PixiRuntime implements RendererRuntime {
  readonly #options: PixiRuntimeOptions;
  readonly #requested: RendererBackend;
  readonly #lifecycle = new RendererLifecycle();
  #viewport: Viewport;
  #capabilities: Capabilities | null = null;
  #attempts: readonly BackendAttempt[] = [];
  #started: StartedBackend | null = null;
  #contexts = 0;
  #stage: Container | null = null;
  #graph: PixiSceneGraph | null = null;
  #view: CameraView | null = null;
  #textures = new Map<ResourceId, TextureEntry>();
  #tilesets = new Map<ResourceId, TilesetEntry>();
  readonly #terrain: TerrainSettings;
  #frames = 0;
  #draws = 0;
  #frameDraws: number | null = null;
  readonly #recoveries: RecoveryEvent[] = [];

  constructor(options: PixiRuntimeOptions) {
    const failures = new Failures();
    checkViewport(failures, "viewport", options.viewport);
    if (options.backend !== undefined && !["auto", "webgl2", "webgpu"].includes(options.backend)) failures.add("backend", 'must be "auto", "webgl2" or "webgpu"');
    const terrain = { ...DEFAULT_TERRAIN, ...options.terrain };
    for (const problem of terrainSettingsProblems(terrain)) failures.add(`terrain.${problem.slice(0, problem.indexOf(":"))}`, problem.slice(problem.indexOf(":") + 2));
    failures.throwIfAny("renderer options");
    this.#terrain = terrain;
    this.#options = options;
    this.#requested = options.backend ?? "auto";
    this.#viewport = { ...options.viewport };
  }

  async initialize(): Promise<void> {
    this.#lifecycle.assert("initialize");
    this.#lifecycle.transition("initialize");
    let started: StartedBackend;
    try {
      const capabilities = this.#options.capabilities ?? await probeCapabilities();
      this.#capabilities = capabilities;
      const settings: BackendSettings = { ...this.#viewport, background: this.#options.background };
      const plan = planBackends(this.#requested, this.#options.autoPreference);
      const selected = await selectBackend(plan, capabilities, (backend) => START[backend](settings));
      started = selected.value;
      this.#attempts = selected.attempts;
      this.#contexts = 1;
      if (this.#lifecycle.state === "destroyed") {
        this.#contexts = (await started.dispose()) ? 0 : 1;
        throw new LifecycleError("the renderer was destroyed while it initialized");
      }
    } catch (error) {
      if (error instanceof BackendSelectionError) this.#attempts = error.attempts;
      if (this.#lifecycle.state === "initializing") this.#lifecycle.transition("initialize-failed", describe(error));
      throw error;
    }
    for (const attempt of this.#attempts) {
      if (attempt.outcome === "selected") continue;
      this.#recoveries.push({ at: 0, kind: "fallback", detail: `${attempt.backend} ${attempt.outcome}: ${attempt.reason}; started ${started.backend}` });
    }
    started.onLost((detail) => this.#lose(detail));
    countDrawCalls(started.renderer, () => {
      this.#draws += 1;
    });
    this.#options.container.appendChild(started.canvas);
    this.#started = started;
    this.#stage = new Container({ label: "renderlab.stage" });
    this.#lifecycle.transition("initialized");
  }

  async mountScene(definition: SceneDefinition): Promise<void> {
    this.#lifecycle.assert("mountScene");
    const store = new SceneStore(definition);
    const snapshot = store.snapshot();
    const unsupported = unsupportedObjects(snapshot.objects);
    if (unsupported.length) throw new UnsupportedSceneError(unsupported);
    const maxEdge = (this.#capabilities && this.#started && maxTextureEdge(this.#capabilities, this.#started.backend)) || MAX_TEXTURE_EDGE;
    // Every declared texture loads now, so later deltas can use any of them synchronously.
    const loaded = new Map<ResourceId, TextureEntry>();
    const tilesets = new Map<ResourceId, TilesetEntry>();
    let graph: PixiSceneGraph;
    try {
      for (const resource of snapshot.resources) {
        if (resource.kind === "tileset") {
          tilesets.set(resource.id, this.#tilesets.get(resource.id) ?? await loadTileset(this.#options.textures, resource, maxEdge));
          continue;
        }
        if (resource.kind !== "texture") continue;
        const reused = this.#textures.get(resource.id);
        if (reused) loaded.set(resource.id, reused);
        else loaded.set(resource.id, createTexture(checkTexturePixels(resource.id, await this.#options.textures.texture(resource), maxEdge)));
      }
      if (!this.#lifecycle.can("mountScene")) throw new LifecycleError(`the renderer became ${this.#lifecycle.state} while the scene loaded`);
      graph = new PixiSceneGraph(store, (id) => (loaded.get(id) as TextureEntry).texture, (id) => (tilesets.get(id) as TilesetEntry).loaded, this.#terrain);
    } catch (error) {
      for (const [id, entry] of loaded) if (!this.#textures.has(id)) entry.texture.destroy(true);
      for (const [id, entry] of tilesets) if (!this.#tilesets.has(id)) releaseTileset(entry);
      throw error;
    }
    this.#graph?.destroy();
    for (const [id, entry] of this.#textures) if (!loaded.has(id)) entry.texture.destroy(true);
    for (const [id, entry] of this.#tilesets) if (!tilesets.has(id)) releaseTileset(entry);
    this.#textures = loaded;
    this.#tilesets = tilesets;
    this.#graph = graph;
    this.#applyView();
    (this.#stage as Container).addChild(graph.root);
    this.#lifecycle.transition("mount");
  }

  applySceneDelta(delta: SceneDelta): SceneDirty {
    this.#lifecycle.assert("applySceneDelta");
    const graph = this.#graph as PixiSceneGraph;
    const refused = refusals(delta, {
      texture: (id) => this.#textures.has(id as ResourceId),
      tiles: (id) => this.#tilesets.get(id as ResourceId)?.loaded.regions,
      object: (id) => graph.store.object(id),
    });
    if (refused.length) throw new UnsupportedSceneError(refused);
    const dirty = graph.store.apply(delta);
    graph.apply(dirty);
    if (dirty.camera) this.#applyView();
    for (const id of dirty.resources.removed) {
      this.#textures.get(id)?.texture.destroy(true);
      this.#textures.delete(id);
      const tileset = this.#tilesets.get(id);
      if (tileset) releaseTileset(tileset);
      this.#tilesets.delete(id);
    }
    return dirty;
  }

  update(snapshot: PresentationSnapshot): void {
    this.#lifecycle.assert("update");
    // Validated and frozen now; binding entities to scene objects arrives with RLDR-015.
    acceptSnapshot(snapshot);
  }

  render(alpha: number): void {
    this.#lifecycle.assert("render");
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new ContractError("render alpha", ["alpha: must be from 0 to 1"]);
    this.#draws = 0;
    (this.#started as StartedBackend).renderer.render(this.#stage as Container);
    this.#frameDraws = this.#draws;
    this.#frames += 1;
  }

  resize(viewport: Viewport): void {
    const failures = new Failures();
    checkViewport(failures, "viewport", viewport);
    failures.throwIfAny("viewport");
    this.#lifecycle.assert("resize");
    this.#viewport = { ...viewport };
    if (this.#lifecycle.state !== "lost") this.#started?.renderer.resize(viewport.width, viewport.height, viewport.dpr);
    this.#applyView();
  }

  getDiagnostics(): RendererDiagnostics {
    const base = emptyDiagnostics(this.#requested, this.#lifecycle.state);
    let bytes = 0;
    let textures = this.#textures.size;
    for (const entry of this.#textures.values()) bytes += entry.bytes;
    for (const entry of this.#tilesets.values()) {
      textures += entry.pages.length;
      for (const page of entry.pages) bytes += page.bytes;
    }
    const terrain = this.#graph?.terrainStats();
    return {
      ...base,
      backend: { requested: this.#requested, active: this.#started?.backend ?? null, failure: this.#lifecycle.failure, attempts: [...this.#attempts] },
      capabilities: this.#capabilities,
      view: this.#view,
      frames: { ...base.frames, rendered: this.#frames },
      scene: { ...base.scene, id: this.#graph?.store.id ?? null, revision: this.#graph?.store.revision ?? null, visibleChunks: terrain?.active ?? 0 },
      gpu: {
        contexts: this.#contexts, drawCalls: this.#frameDraws === null ? null : { value: this.#frameDraws, basis: "counted" }, textures,
        textureBytes: this.#started ? { value: bytes, basis: "estimated" } : null,
      },
      terrain: terrain ? {
        chunks: terrain.chunks, active: terrain.active, resident: terrain.resident, budget: terrain.budget, builds: terrain.builds,
        rebuilds: terrain.rebuilds, evictions: terrain.evictions, meshes: terrain.meshes,
      } : null,
      recoveries: [...this.#recoveries],
    };
  }

  async destroy(): Promise<void> {
    this.#lifecycle.assert("destroy");
    this.#lifecycle.transition("destroy");
    this.#graph?.destroy();
    this.#graph = null;
    this.#view = null;
    for (const entry of this.#textures.values()) entry.texture.destroy(true);
    this.#textures = new Map();
    for (const entry of this.#tilesets.values()) releaseTileset(entry);
    this.#tilesets = new Map();
    this.#stage?.destroy({ children: true });
    this.#stage = null;
    const started = this.#started;
    this.#started = null;
    if (started) this.#contexts = (await started.dispose()) ? 0 : 1;
  }

  /** Recompute the camera view from the scene's camera, the viewport and the pixel policy, and place the layers. */
  #applyView(): void {
    if (!this.#graph) return;
    this.#view = computeView(this.#graph.store.camera, this.#viewport, this.#options.pixelPolicy ?? SMOOTH_SNAPPED);
    this.#graph.applyView(this.#view);
  }

  #lose(detail: string): void {
    if (this.#lifecycle.state !== "ready" && this.#lifecycle.state !== "mounted") return;
    this.#lifecycle.transition("lose");
    this.#recoveries.push({ at: this.#frames, kind: "context-lost", detail: `${detail}; rendering stopped` });
  }
}
