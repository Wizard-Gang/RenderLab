# GPU backends

RenderLab draws through PixiJS v8, pinned exactly in `package.json`. Two backends sit behind the renderer-neutral `RendererRuntime` contract, as the [specification](specifications/2026-10-18-renderlab.md) §6 and §16 require:

- **WebGL2**, the initial production baseline (RLDR-003);
- **WebGPU**, a fully supported, independently validated backend (RLDR-004).

`PixiRuntime` (`src/render/pixi/runtime.ts`) runs either one. Each backend's PixiJS renderer is its own code chunk, loaded only when that backend is chosen.

## Choosing a backend

`RendererBackend` is `"auto"`, `"webgl2"` or `"webgpu"` (`src/core/capabilities/selection.ts`):

- **`auto`** (the default) tries its preferred backend first and the other one as a permitted fallback. The preference is WebGL2 until WebGPU's production qualification; only a governed change moves it. `autoPreference: "webgpu"` exists so the WebGPU-first path and its fallback (§6.4) are exercised today.
- **An explicit backend** is tried alone. If it cannot start, the runtime reports why and stays failed; it never downgrades silently.

Before trying anything, the runtime probes capabilities from the graphics APIs themselves (`src/render/backends/probe.ts`):

- WebGL2 availability and `MAX_TEXTURE_SIZE`;
- WebGPU availability, and when it is available, the adapter's vendor, architecture and fallback flag, `maxTextureDimension2D`, its features and the preferred canvas format;
- secure context, device pixel ratio and reduced motion.

A backend the probe finds unavailable is skipped with its reason, and one that fails while starting is recorded as failed. Each start releases whatever it created before it reports failure. Diagnostics carry the requested backend, the active one, every attempt with its outcome and reason, and the probed capabilities. A fallback is also logged as a recovery event. Nothing reads the user agent: `npm run check` refuses any source under `src/` that mentions `userAgent`.

Messages read like their cause, for example `WebGPU is unavailable: no WebGPU adapter is available`, `WebGPU failed to start: the device could not present a frame: …`, or, when `auto` runs out of options, `no permitted graphics backend could start. WebGL2 is unavailable: …; WebGPU is unavailable: …`.

## WebGL2

The runtime creates the canvas's `webgl2` context itself and hands it to PixiJS (`src/render/backends/webgl2.ts`, `webgl2-context.ts`). PixiJS therefore never falls back to WebGL 1. The attributes are `alpha: false`, `antialias: false`, `depth: false`, `stencil: true`, `premultipliedAlpha: true` and `preserveDrawingBuffer: false`, and `failIfMajorPerformanceCaveat: false` lets software rasterizers run. After initialization the runtime checks that PixiJS reports WebGL 2. Disposal destroys the renderer and canvas, then makes sure the context reports lost through `WEBGL_lose_context`. A `webglcontextlost` event moves the lifecycle to `lost`.

## WebGPU

The runtime requests its own adapter and device and hands them to PixiJS (`src/render/backends/webgpu.ts`). Given a device, PixiJS neither destroys it nor silently replaces it on loss, so the runtime owns both:

- **Startup.** After PixiJS initializes, the runtime presents one empty frame inside validation, internal and out-of-memory error scopes. It waits for the GPU to finish the frame, then waits a short grace period for a device loss. Some adapters create a device that cannot present to a canvas; SwiftShader in headless Chromium without Vulkan is one. Such a device is lost on its first frame. The check turns that into a start failure that `auto` falls back from, instead of a black canvas.
- **Disposal.** Destroys the renderer, the canvas and the device, then waits for `device.lost` to resolve as `destroyed` before it reports the device released.
- **Loss.** Any other device loss moves the lifecycle to `lost` and refuses further draws.

## Shared behaviour

**Scenes.** `mountScene` builds a fresh `SceneStore` from the core definition, and a `PixiSceneGraph` (`src/render/pixi/scene-graph.ts`) from that store:

- One PixiJS container per layer. A layer's own objects draw before its child layers, siblings draw by `order`, and objects within a layer draw by `sortKey` and then by ID.
- `applySceneDelta` updates only what the delta's `SceneDirty` names, and re-ranks a layer only when its membership or a `sortKey` changes.
- The graph needs no GPU, so it is unit-tested in node.
- A remount builds the new graph before it tears down the old one, so a scene that fails to load leaves the previous one drawing.

Both runtimes present **sprites only**. A scene or delta containing tile chunks, characters, particles or effects is refused with an `UnsupportedSceneError` naming each object. RLDR-009 and later tasks add those kinds.

**Coordinates.** The runtime computes the camera view (see [Architecture](ARCHITECTURE.md), Coordinates and the camera) on mount, after every camera change and on resize, under its `pixelPolicy` (smooth with a snapped origin by default, or strict pixels), and places each layer from it. The backing store is scaled by the viewport's DPR. Rotations convert from the model's degrees to PixiJS radians, and mirroring becomes a negative scale about the sprite's anchor (`src/render/pixi/translate.ts`).

**Textures and alpha.** Every texture resource a scene declares is loaded when it mounts, from a `TextureProvider` of straight-alpha RGBA8 pixels (`src/render/textures.ts`), until RLDR-006 and RLDR-007 compile real artwork.

- **Premultiplication.** PixiJS premultiplies buffer uploads on WebGL2 but writes them unchanged on WebGPU. RenderLab therefore premultiplies texels itself and uploads them as `premultiplied-alpha`, so both backends receive identical bytes. The reference scene's half-transparent glass texel proves it on both backends.
- **Upload.** Textures upload as `rgba8unorm` without mipmaps, sampled `nearest` (pixel art) or `linear`.
- **Size.** An edge above the active backend's probed limit is refused; 2048 applies before probing.
- **Lifetime.** A texture shared by the old and new scene survives a remount, and any other texture is destroyed, as is one whose resource a delta removes.

**Teardown.** `destroy` releases every display object and texture and disposes of the backend. Diagnostics then show `textures: 0` and `contexts: 0` only once the GPU has confirmed the release. The reference application's **Restart renderer** button shows exactly that.

**Context and device loss.** On loss, the runtime records a recovery event and refuses `render`, `update` and `applySceneDelta` with a precise `LifecycleError`, so no invalid GPU command is issued. Restoring the context or device and its resources is RLDR-017's job; until then a lost renderer is destroyed and created again.

**Diagnostics.** Frames rendered, live textures, live contexts or devices, and estimated texture memory (`width × height × 4` bytes per texture, labelled *estimated*). Draw calls are not reported until a later task measures them.

## Browsers and CI

The Playwright suite runs every backend test in Chromium and WebKit, WebKit standing in for Safari:

- **Chromium.** Headless Chromium has no WebGPU adapter by default. It runs with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader`, which gives it SwiftShader for WebGPU (through Vulkan, which it needs to present) and for WebGL2.
- **WebGL2** must render in both browsers; a missing WebGL2 fails the run.
- **WebGPU outcome.** The probe's answer and the actual start outcome are logged and annotated on every run. An adapter can exist and still fail to start: headless Linux Chromium's SwiftShader device could not present. So the tests key off the outcome. Where WebGPU starts, the suite checks its pixels, teardown and device loss. Where it does not, the suite checks that an explicit `webgpu` request names the exact reason, and the WebGPU-only teardown and loss tests skip with that reason, never passing silently.
- **Pixels.** The tests read real canvas output: a CSS-scale element screenshot decoded in the test, within six steps per channel.

| Environment | WebGL2 | WebGPU |
| --- | --- | --- |
| Chromium 1248, headless, macOS (Playwright 1.64.1, flags above) | Reference pixels pass | Reference pixels pass on SwiftShader (fallback adapter) |
| WebKit 2370, headless, macOS (Playwright 1.64.1) | Reference pixels pass | Reference pixels pass on the Apple adapter |
| Chromium on `ubuntu-latest` CI | Checked on every PR by the required `verify` job | SwiftShader adapter found, but its device cannot present: WebGPU fails to start with "Instance dropped in popErrorScope", with or without `--disable-vulkan-surface` (2026-10-19). Reported per run |
| WebKit on `ubuntu-latest` CI | Checked on every PR by the required `verify` job | Unavailable: `navigator.gpu` is not exposed (reported per run) |

Because CI may not present WebGPU, a change under `src/render/` also runs the browser suite locally on macOS, where both browsers present WebGPU, and records that run in its Validation field.
