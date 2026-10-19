// The PixiJS v8 runtime on a verified WebGL2 context (RLDR-003). It implements the renderer-neutral RendererRuntime:
// scenes arrive as the core model and change through atomic deltas, and PixiJS objects never leave src/render/.
import { BufferImageSource, Container, Texture, WebGLRenderer } from "pixi.js";
import {
  acceptSnapshot, checkViewport, ContractError, emptyDiagnostics, Failures, LifecycleError, RendererLifecycle, SceneStore,
  type PresentationSnapshot, type RecoveryEvent, type RendererDiagnostics, type RendererRuntime, type ResourceId,
  type SceneChange, type SceneDefinition, type SceneDelta, type SceneDirty, type Viewport,
} from "../../core";
import { BackendUnavailableError, UnsupportedSceneError } from "../errors";
import { checkTexturePixels, type TexturePixels, type TextureProvider } from "../textures";
import { createWebGL2Context } from "./context";
import { PixiSceneGraph, SUPPORTED_KINDS, unsupportedObjects } from "./scene-graph";

export interface WebGL2RuntimeOptions {
  /** The element the canvas is appended to. */
  readonly container: HTMLElement;
  readonly viewport: Viewport;
  readonly textures: TextureProvider;
  /** The clear colour behind every layer, 0xRRGGBB. */
  readonly background: number;
}

interface TextureEntry {
  readonly texture: Texture;
  readonly bytes: number;
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function createTexture(pixels: TexturePixels): TextureEntry {
  const source = new BufferImageSource({
    resource: new Uint8Array(pixels.rgba), width: pixels.width, height: pixels.height, format: "rgba8unorm",
    alphaMode: "premultiply-alpha-on-upload", scaleMode: pixels.filtering, autoGenerateMipmaps: false,
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

export class PixiWebGL2Runtime implements RendererRuntime {
  readonly #options: WebGL2RuntimeOptions;
  readonly #lifecycle = new RendererLifecycle();
  #viewport: Viewport;
  #renderer: WebGLRenderer | null = null;
  #gl: WebGL2RenderingContext | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #stage: Container | null = null;
  #graph: PixiSceneGraph | null = null;
  #textures = new Map<ResourceId, TextureEntry>();
  #frames = 0;
  readonly #recoveries: RecoveryEvent[] = [];
  readonly #onContextLost = (): void => {
    if (this.#lifecycle.state !== "ready" && this.#lifecycle.state !== "mounted") return;
    this.#lifecycle.transition("lose");
    this.#recoveries.push({ at: this.#frames, kind: "context-lost", detail: "the WebGL2 context was lost; rendering stopped" });
  };

  constructor(options: WebGL2RuntimeOptions) {
    const failures = new Failures();
    checkViewport(failures, "viewport", options.viewport);
    failures.throwIfAny("WebGL2 runtime options");
    this.#options = options;
    this.#viewport = { ...options.viewport };
  }

  async initialize(): Promise<void> {
    this.#lifecycle.assert("initialize");
    this.#lifecycle.transition("initialize");
    const canvas = document.createElement("canvas");
    let renderer: WebGLRenderer | null = null;
    try {
      this.#gl = createWebGL2Context(canvas);
      renderer = new WebGLRenderer();
      await renderer.init({
        canvas, context: this.#gl, width: this.#viewport.width, height: this.#viewport.height, resolution: this.#viewport.dpr,
        autoDensity: true, antialias: false, background: this.#options.background, backgroundAlpha: 1, clearBeforeRender: true,
      });
      if (renderer.context.webGLVersion !== 2) {
        throw new BackendUnavailableError("webgl2", `PixiJS initialized WebGL ${renderer.context.webGLVersion}, not WebGL2`);
      }
      if (this.#lifecycle.state === "destroyed") throw new LifecycleError("the renderer was destroyed while it initialized");
    } catch (error) {
      try {
        renderer?.destroy({ removeView: true });
      } catch {
        // A renderer that failed part-way through init may not tear down cleanly; its context is released below.
      }
      this.#release();
      if (this.#lifecycle.state === "initializing") this.#lifecycle.transition("initialize-failed", describe(error));
      throw error;
    }
    canvas.addEventListener("webglcontextlost", this.#onContextLost);
    this.#options.container.appendChild(canvas);
    this.#renderer = renderer;
    this.#canvas = canvas;
    this.#stage = new Container({ label: "renderlab.stage" });
    this.#lifecycle.transition("initialized");
  }

  async mountScene(definition: SceneDefinition): Promise<void> {
    this.#lifecycle.assert("mountScene");
    const store = new SceneStore(definition);
    const snapshot = store.snapshot();
    const unsupported = unsupportedObjects(snapshot.objects);
    if (unsupported.length) throw new UnsupportedSceneError(unsupported);
    // Every declared texture loads now, so later deltas can use any of them synchronously.
    const loaded = new Map<ResourceId, TextureEntry>();
    let graph: PixiSceneGraph;
    try {
      for (const resource of snapshot.resources) {
        if (resource.kind !== "texture") continue;
        const reused = this.#textures.get(resource.id);
        if (reused) loaded.set(resource.id, reused);
        else loaded.set(resource.id, createTexture(checkTexturePixels(resource.id, await this.#options.textures.texture(resource))));
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
    (this.#renderer as WebGLRenderer).render(this.#stage as Container);
    this.#frames += 1;
  }

  resize(viewport: Viewport): void {
    const failures = new Failures();
    checkViewport(failures, "viewport", viewport);
    failures.throwIfAny("viewport");
    this.#lifecycle.assert("resize");
    this.#viewport = { ...viewport };
    if (this.#lifecycle.state !== "lost") this.#renderer?.resize(viewport.width, viewport.height, viewport.dpr);
  }

  getDiagnostics(): RendererDiagnostics {
    const base = emptyDiagnostics("webgl2", this.#lifecycle.state);
    let bytes = 0;
    for (const entry of this.#textures.values()) bytes += entry.bytes;
    return {
      ...base,
      backend: { requested: "webgl2", active: this.#renderer ? "webgl2" : null, failure: this.#lifecycle.failure },
      frames: { ...base.frames, rendered: this.#frames },
      scene: { ...base.scene, id: this.#graph?.store.id ?? null, revision: this.#graph?.store.revision ?? null },
      gpu: {
        contexts: this.#gl ? 1 : 0, drawCalls: null, textures: this.#textures.size,
        textureBytes: this.#renderer ? { value: bytes, basis: "estimated" } : null,
      },
      recoveries: [...this.#recoveries],
    };
  }

  async destroy(): Promise<void> {
    this.#lifecycle.assert("destroy");
    this.#lifecycle.transition("destroy");
    this.#canvas?.removeEventListener("webglcontextlost", this.#onContextLost);
    this.#graph?.destroy();
    this.#graph = null;
    for (const entry of this.#textures.values()) entry.texture.destroy(true);
    this.#textures = new Map();
    this.#stage?.destroy({ children: true });
    this.#stage = null;
    this.#renderer?.destroy({ removeView: true });
    this.#renderer = null;
    this.#canvas?.remove();
    this.#canvas = null;
    this.#release();
  }

  /** Lose the context deliberately so its GPU memory goes now, and drop it once it reports lost. */
  #release(): void {
    const gl = this.#gl;
    if (gl && !gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.#gl = gl && !gl.isContextLost() ? gl : null;
  }
}
