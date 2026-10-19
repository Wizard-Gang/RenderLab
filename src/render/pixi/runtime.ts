// The PixiJS v8 runtime behind the renderer-neutral RendererRuntime, on WebGL2 (RLDR-003) or WebGPU (RLDR-004).
// Scenes arrive as the core model and change through atomic deltas; PixiJS objects never leave src/render/.
import { BufferImageSource, Container, Texture } from "pixi.js";
import {
  acceptSnapshot, BackendSelectionError, checkViewport, ContractError, emptyDiagnostics, Failures, LifecycleError,
  maxTextureEdge, planBackends, RendererLifecycle, SceneStore, selectBackend,
  type ActiveBackend, type BackendAttempt, type Capabilities, type PresentationSnapshot, type RecoveryEvent,
  type RendererBackend, type RendererDiagnostics, type RendererRuntime, type ResourceId, type SceneChange,
  type SceneDefinition, type SceneDelta, type SceneDirty, type Viewport,
} from "../../core";
import { probeCapabilities } from "../backends/probe";
import type { BackendSettings, StartedBackend } from "../backends/started";
import { UnsupportedSceneError } from "../errors";
import { checkTexturePixels, MAX_TEXTURE_EDGE, premultiplied, type TexturePixels, type TextureProvider } from "../textures";
import { PixiSceneGraph, SUPPORTED_KINDS, unsupportedObjects } from "./scene-graph";

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
}

interface TextureEntry {
  readonly texture: Texture;
  readonly bytes: number;
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

/** Why a delta cannot be presented, checked before the scene store changes so a refused delta changes nothing. */
function refusals(delta: SceneDelta, loaded: (id: unknown) => boolean): string[] {
  return (Array.isArray(delta) ? delta : []).flatMap((change: SceneChange, index) => {
    const at = `delta[${index}]`;
    if (change?.op === "add" && change.object && !SUPPORTED_KINDS.includes(change.object.kind)) {
      return unsupportedObjects([change.object]).map((reason) => `${at}: ${reason}`);
    }
    if (change?.op === "add" && change.object?.kind === "sprite" && !loaded(change.object.texture)) {
      return [`${at}: texture ${change.object.texture} was not declared when the scene mounted`];
    }
    if (change?.op === "update" && change.patch && "texture" in change.patch && !loaded(change.patch.texture)) {
      return [`${at}: texture ${String(change.patch.texture)} was not declared when the scene mounted`];
    }
    if (change?.op === "add-resource" && change.resource?.kind === "texture" && !loaded(change.resource.id)) {
      return [`${at}: textures are loaded when a scene mounts; on-demand loading arrives with RLDR-006`];
    }
    return [];
  });
}

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
  #textures = new Map<ResourceId, TextureEntry>();
  #frames = 0;
  readonly #recoveries: RecoveryEvent[] = [];

  constructor(options: PixiRuntimeOptions) {
    const failures = new Failures();
    checkViewport(failures, "viewport", options.viewport);
    if (options.backend !== undefined && !["auto", "webgl2", "webgpu"].includes(options.backend)) failures.add("backend", 'must be "auto", "webgl2" or "webgpu"');
    failures.throwIfAny("renderer options");
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
    let graph: PixiSceneGraph;
    try {
      for (const resource of snapshot.resources) {
        if (resource.kind !== "texture") continue;
        const reused = this.#textures.get(resource.id);
        if (reused) loaded.set(resource.id, reused);
        else loaded.set(resource.id, createTexture(checkTexturePixels(resource.id, await this.#options.textures.texture(resource), maxEdge)));
      }
      if (!this.#lifecycle.can("mountScene")) throw new LifecycleError(`the renderer became ${this.#lifecycle.state} while the scene loaded`);
      graph = new PixiSceneGraph(store, (id) => (loaded.get(id) as TextureEntry).texture);
    } catch (error) {
      for (const [id, entry] of loaded) if (!this.#textures.has(id)) entry.texture.destroy(true);
      throw error;
    }
    this.#graph?.destroy();
    for (const [id, entry] of this.#textures) if (!loaded.has(id)) entry.texture.destroy(true);
    this.#textures = loaded;
    this.#graph = graph;
    (this.#stage as Container).addChild(graph.root);
    this.#lifecycle.transition("mount");
  }

  applySceneDelta(delta: SceneDelta): SceneDirty {
    this.#lifecycle.assert("applySceneDelta");
    const refused = refusals(delta, (id) => this.#textures.has(id as ResourceId));
    if (refused.length) throw new UnsupportedSceneError(refused);
    const graph = this.#graph as PixiSceneGraph;
    const dirty = graph.store.apply(delta);
    graph.apply(dirty);
    for (const id of dirty.resources.removed) {
      this.#textures.get(id)?.texture.destroy(true);
      this.#textures.delete(id);
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
    (this.#started as StartedBackend).renderer.render(this.#stage as Container);
    this.#frames += 1;
  }

  resize(viewport: Viewport): void {
    const failures = new Failures();
    checkViewport(failures, "viewport", viewport);
    failures.throwIfAny("viewport");
    this.#lifecycle.assert("resize");
    this.#viewport = { ...viewport };
    if (this.#lifecycle.state !== "lost") this.#started?.renderer.resize(viewport.width, viewport.height, viewport.dpr);
  }

  getDiagnostics(): RendererDiagnostics {
    const base = emptyDiagnostics(this.#requested, this.#lifecycle.state);
    let bytes = 0;
    for (const entry of this.#textures.values()) bytes += entry.bytes;
    return {
      ...base,
      backend: { requested: this.#requested, active: this.#started?.backend ?? null, failure: this.#lifecycle.failure, attempts: [...this.#attempts] },
      capabilities: this.#capabilities,
      frames: { ...base.frames, rendered: this.#frames },
      scene: { ...base.scene, id: this.#graph?.store.id ?? null, revision: this.#graph?.store.revision ?? null },
      gpu: {
        contexts: this.#contexts, drawCalls: null, textures: this.#textures.size,
        textureBytes: this.#started ? { value: bytes, basis: "estimated" } : null,
      },
      recoveries: [...this.#recoveries],
    };
  }

  async destroy(): Promise<void> {
    this.#lifecycle.assert("destroy");
    this.#lifecycle.transition("destroy");
    this.#graph?.destroy();
    this.#graph = null;
    for (const entry of this.#textures.values()) entry.texture.destroy(true);
    this.#textures = new Map();
    this.#stage?.destroy({ children: true });
    this.#stage = null;
    const started = this.#started;
    this.#started = null;
    if (started) this.#contexts = (await started.dispose()) ? 0 : 1;
  }

  #lose(detail: string): void {
    if (this.#lifecycle.state !== "ready" && this.#lifecycle.state !== "mounted") return;
    this.#lifecycle.transition("lose");
    this.#recoveries.push({ at: this.#frames, kind: "context-lost", detail: `${detail}; rendering stopped` });
  }
}
