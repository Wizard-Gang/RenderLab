# GPU backends

RenderLab draws through PixiJS v8, pinned exactly in `package.json`. The [specification](specifications/2026-10-18-renderlab.md) §6 and §16 call for two backends behind the renderer-neutral `RendererRuntime` contract: WebGL2, the initial production baseline, and WebGPU, a fully supported and independently validated backend. This document records what each backend does today.

| Backend | Status | Runtime |
| --- | --- | --- |
| WebGL2 | Baseline since RLDR-003 | `PixiWebGL2Runtime` (`src/render/pixi/webgl2-runtime.ts`) |
| WebGPU | Arrives with RLDR-004, together with capability probing and `auto` selection | — |

## WebGL2 baseline

**Context.** The runtime creates the canvas's `webgl2` context itself and hands it to PixiJS (`createWebGL2Context`, `src/render/pixi/context.ts`). PixiJS therefore never falls back to WebGL 1; a context that is not a `WebGL2RenderingContext` is refused. The attributes are `alpha: false`, `antialias: false`, `depth: false`, `stencil: true`, `premultipliedAlpha: true` and `preserveDrawingBuffer: false`. `failIfMajorPerformanceCaveat: false` accepts software rasterizers, so headless CI renders. After initialization the runtime checks that PixiJS reports WebGL 2. A browser without WebGL2 gets a `BackendUnavailableError` whose message the reference application shows in place of a blank canvas, for example `WebGL2 is unavailable: this browser or device did not provide a WebGL2 context`.

**Scenes.** `mountScene` builds a fresh `SceneStore` from the core definition and a `PixiSceneGraph` (`src/render/pixi/scene-graph.ts`) from that. The graph creates one PixiJS container per layer: the layer's own objects draw before its child layers, siblings draw by `order`, and objects within a layer draw by `sortKey` and then by ID. `applySceneDelta` updates only what the delta's `SceneDirty` names, and re-ranks a layer only when membership or a `sortKey` changes. The graph needs no GPU, so it is unit-tested in node. A remount builds the new graph before it tears down the old one, so a scene that fails to load leaves the previous one drawing. This runtime presents **sprites only**. A scene or delta containing tile chunks, characters, particles or effects is refused with an `UnsupportedSceneError` naming each object; nothing is drawn partially or silently dropped. RLDR-009 and later tasks add those kinds.

**Coordinates.** The camera is identity until RLDR-005: one world unit is one CSS pixel from the canvas's top-left corner, and the canvas backing store is scaled by the viewport's DPR (`autoDensity`). Rotations convert from the model's degrees to PixiJS radians, and mirroring becomes a negative scale about the sprite's anchor (`src/render/pixi/translate.ts`, which is pure and unit-tested).

**Textures.** Every texture resource a scene declares is loaded when it mounts, from a `TextureProvider` that returns straight-alpha RGBA8 pixels (`src/render/textures.ts`). This is a stand-in until RLDR-006 and RLDR-007 compile real artwork. Pixels upload as `rgba8unorm` with `premultiply-alpha-on-upload` and no mipmaps, sampled `nearest` (pixel art) or `linear` as each texture asks. Edges above 2048 are refused until RLDR-004 probes device limits. A texture used by both the old and the new scene survives a remount, and any other texture is destroyed. So is a texture whose resource a delta removes. Adding a texture resource after mount is refused until RLDR-006 loads on demand.

**Teardown.** `destroy` destroys every sprite, layer container and texture, then the PixiJS renderer with its canvas. It then makes sure the WebGL2 context reports lost: PixiJS calls `WEBGL_lose_context`, and the runtime calls it again if it did not. Only then does it drop the context. Diagnostics after `destroy` show `state: destroyed`, `textures: 0` and `contexts: 0`, and the reference application's **Restart renderer** button shows exactly that.

**Context loss.** When the browser reports `webglcontextlost`, the runtime moves to the `lost` lifecycle state and records a recovery event. `render`, `update` and `applySceneDelta` are then refused with a precise `LifecycleError`, so no invalid GPU command is issued. Restoring the context and its resources is RLDR-017's job. Until then a lost renderer is destroyed and created again.

**Diagnostics.** Frames rendered, live textures, live contexts and an estimated texture memory figure (`width × height × 4` bytes per texture, labelled *estimated*). Draw calls are not reported until a later task measures them.

## Browsers and CI

The Playwright suite runs every test in Chromium and WebKit, WebKit standing in for Safari. Both must provide WebGL2: a test reports a missing capability as a failure, never as a skip. Playwright launches Chromium with `--enable-unsafe-swiftshader`, so headless Linux CI renders WebGL2 through SwiftShader, and WebKit uses its own WebGL2 implementation. The pixel tests read real canvas output: a CSS-scale element screenshot, decoded in the test, with a tolerance of six steps per channel for software rasterizers and colour conversion.
