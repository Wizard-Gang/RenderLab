# Architecture

RenderLab is a standalone, game-engine-independent 2D presentation platform. It validates, compiles, loads and draws content exported by two independent authoring tools, MapLab (worlds) and RigLab (characters and animation), through PixiJS v8 on WebGL2 and WebGPU. A separate game or reference simulation owns authoritative state and hands RenderLab presentation snapshots. RenderLab never writes back into it. The [governing specification](specifications/2026-10-18-renderlab.md) is the full contract. This document records what the repository implements today and the boundaries it enforces.

## Current state

The repository holds its governance, its toolchain, the renderer-neutral core contracts (`src/core/`, RLDR-002), the PixiJS v8 runtime on WebGL2 and WebGPU with capability-based backend selection (`src/render/`, RLDR-003 and RLDR-004), the 2D camera (`src/core/camera/`, RLDR-005), and the reference application (`index.html`, `src/demo/`). The application draws generated demo scenes on the chosen backend, with camera controls, and shows the runtime's diagnostics and the probed capabilities. The renderer, asset pipeline and adapters arrive through the tasks in [implementation_plan.md](../implementation_plan.md), in specification order. Each task updates this document when it adds a boundary or module.

## Data flow

```text
MapLab export ─┐                                   ┌─ WebGL2
               ├─ validate ─ compile ─ scene runtime ─ PixiJS v8 adapter ─┤
RigLab export ─┘   (integrity,   (atlases,   ▲                              └─ WebGPU
                    versions)     batches)   │
                                  game / reference simulation ─ presentation snapshots
```

MapLab and RigLab are the only authorities for authored content. RenderLab reads their **exported artifacts**: versioned bundles with SHA-256 manifests. It never reads their editor state, storage or code. Physical data in a MapLab export, such as colliders, footholds and navigation, goes to the game engine. RenderLab may draw it only as optional diagnostic overlays.

## Module layout

The planned source layout follows the specification's §5:

| Area | Responsibility | Lands in |
| --- | --- | --- |
| `src/core/` | Renderer-neutral contracts: scene model, camera, timeline, lifecycle, capabilities and backend selection | RLDR-002, RLDR-004, RLDR-005 |
| `src/assets/` | Bundle reading, integrity, loading, caching, atlases, compilation | RLDR-006, RLDR-007 |
| `src/adapters/` | MapLab and RigLab readers; the replaceable simulation bridge | RLDR-008, RLDR-011, RLDR-015 |
| `src/render/` | The PixiJS v8 runtime, capability probes and backends (WebGL2 and WebGPU), the scene graph; later terrain, skeletal, particles, effects | RLDR-003 onward |
| `src/diagnostics/` | Metrics, profiling, visual parity | RLDR-017 to RLDR-020 |
| `src/demo/` | Reference application UI and scenes (the generated reference scene since RLDR-003) | RLDR-001 (shell), RLDR-003, RLDR-018 |

## Scene model

`src/core/scene/` describes what should appear, never how a GPU draws it (§7, §13):

- **Resources** are descriptors (`texture`, `tileset`, `rig`, `animation`, `skin`, `palette`, `equipment`, `effect`) keyed by stable IDs. Objects name them, and the store keeps a reference count per resource, so an owner knows when one can be released. A renderer resolves descriptors to GPU resources; the model never holds GPU objects.
- **Layers** form a tree. Siblings draw in ascending `order`, which must be unique among them, and a parent draws before its children (`layerDrawOrder`). `role` is an open, informational tag through which MapLab's own layer kinds pass. It never decides order, so MapLab's layer model is not forced into a fixed enumeration. `space`, `parallax`, `opacity` and `occlusionFade` carry MapLab's presentation fields.
- **Objects** are sprites, sparse 32×32 tile chunks (MapLab's cell encoding: a tile, quarter turns and mirroring), RigLab characters (rig, animation state, appearance, and articulated or baked presentation), particle emitters and effects. Within a layer they draw by `sortKey`, then by ID. `static` content changes only through explicit scene changes; tile chunks are always static.
- **Units.** World units are X right and Y down. Rotations are degrees, positive clockwise on screen. Authored values are kept exactly as given.
- **Traceability.** Every layer, object and resource keeps its `source` (authority, source ID and prefab expansion path). RenderLab never mints authoritative world identities.

A `SceneStore` owns one scene and changes only through atomic deltas: all of a delta's changes apply, or none do and a `ContractError` names every failure by path. A delta returns a `SceneDirty` that lists exactly the added, updated and removed objects, the dirty tile chunks, layers and resources, and whether the camera moved. Renderers update only those, and a cell edit dirties only its own chunk. Records are validated as closed shapes, so unknown fields are errors, then copied and frozen on entry. Two stores therefore never share mutable state, callers cannot change a store through retained references, and snapshots never change after they are taken. The same definition and delta sequence always yield the same snapshot; `canonicalJson` gives identical text for equal data.

`src/core/timeline/` holds the animation presentation state (clip, entry tick, facing, pause) and the `PresentationSnapshot` a game hands RenderLab each fixed tick (§14). `acceptSnapshot` validates a snapshot and returns a frozen copy, so presentation can never write back into game state.

## Coordinates and the camera

World units are MapLab's: X right, Y down. A scene's `CameraState` names the world point at the viewport centre, a zoom in CSS pixels per world unit, and optional world bounds; it is stored as asked, before bounds and the pixel policy. `computeView` in `src/core/camera/view.ts` is the **one conversion boundary**:

- A world point `w` lands at CSS pixel `origin + w × zoom` from the viewport's top-left corner.
- Device pixels are CSS pixels × DPR; the renderer scales its backing store by DPR.

`screenToWorld` and `worldToScreen` invert each other to floating-point precision across zooms and DPRs.

**Bounds.** The view stays inside the camera's bounds, and is centred on them along any axis where they are smaller than the view, at every aspect ratio. `clampCamera`, `panBy` (drag), `zoomAt` (zoom about a screen point), `followStep` (one deterministic fixed-tick smoothing step) and `shakeOffset` (seeded, presentation-only) are the camera behaviours, all pure.

**Pixel policies** (§10):
- `smooth` keeps any zoom. With `snap`, the default, it puts the world origin on a device pixel so static art does not shimmer.
- `strict-pixel` rounds zoom × DPR to a whole number of device pixels per world unit, at least one, and snaps the origin. Every whole world coordinate then falls on a device pixel edge, and pixel art draws as equal squares.

Changing the pixel policy never changes the scene or game state.

**Layers.** The renderer applies the view per layer:
- A world root layer carries the whole transform, plus a parallax offset that makes it scroll at `parallax` × the camera's movement. A nested world layer adds only its parallax relative to its parent, snapped to device pixels when the view is snapped.
- Screen-space layers ignore the camera and stay in CSS pixels. Because the transform lives on each root layer rather than on one shared world container, a screen-space layer can sit anywhere in the authored order, even behind the world, as MapLab's camera-space backgrounds do. A layer's space must match its parent's.

Parallax composition beyond this hook, and MapLab camera zones, arrive with RLDR-010.

## Renderer lifecycle

`src/core/lifecycle/` defines the `RendererRuntime` contract every backend implements. It refines the specification's §6.2 proposal: scene changes arrive as atomic deltas, and game state as accepted snapshots. It also defines `RendererDiagnostics`, in which every measurement says whether it was measured, counted or estimated. `RendererLifecycle` is the state machine runtimes drive:

| From | Event | To |
| --- | --- | --- |
| created | initialize | initializing |
| initializing | initialized, or initialize-failed | ready, or failed |
| ready | mount | mounted |
| mounted | mount (replaces the scene), or unmount | mounted, or ready |
| ready or mounted | lose | lost |
| lost | restore, or restore-failed | mounted if a scene was mounted, else ready; or failed |
| any state but destroyed | destroy | destroyed |

`update`, `applySceneDelta` and `render` need a mounted scene. `resize` also works while the device is lost, so the size is kept for the restore. Every other call fails with a `LifecycleError` that says why, so no invalid GPU command is issued.

## Renderers

`src/render/` implements `RendererRuntime` on PixiJS v8. The runtime probes capabilities, picks a backend under the core selection rules (`auto` prefers WebGL2 and may fall back to WebGPU; an explicit backend never downgrades), presents sprites from a mounted scene, updates only what each delta dirties, and refuses content it cannot present yet. [GPU backends](GPU-BACKENDS.md) describes selection, both backends, alpha parity, teardown and loss. The reference application (`src/demo/`) reaches PixiJS only through `src/render/`. It builds the runtime in a React effect and draws on `requestAnimationFrame`; React never holds scene objects.

## Dependency rules

These rules come from the specification's §5 and §6.3. `npm run check` enforces the first four mechanically: `scripts/check-boundaries.mjs` checks every module's imports, and `tsconfig.core.json` compiles `src/core/` with no DOM library and no Node types. The rest bind every change by review until their tasks add checks.

- Core contracts never import PixiJS, React or DOM APIs; `src/core/` imports only modules inside itself.
- PixiJS is imported only under `src/render/`, and React only under `src/demo/`.
- No source reads the user agent; capabilities come from probing the graphics APIs.
- Simulation adapters never depend on the browser DOM.
- MapLab and RigLab adapters never import editor code.
- GPU-specific code stays inside renderer implementations.
- Asset validation stays independently testable.
- Browser UI never becomes gameplay authority, and instrumentation never affects deterministic state.
- React draws application UI only. Terrain, sprites and particles are renderer objects, never one React component each.

The repository contract already enforces the stack boundaries. RenderLab is React and TypeScript only, with no Rust, Cargo or Tauri. `pixi.js`, once added, must be an exact 8.x pin, and competing game or rendering engines (Phaser, three.js, Babylon.js, PlayCanvas and similar) are rejected.

## Toolchain

Node 26.10.0 and npm 12.1.0 are pinned, as are Vite 8, React 19, TypeScript 7, Vitest 5 for node-environment unit and contract tests, and Playwright 1.64 for Chromium and WebKit browser tests. Dependencies are exact versions locked by `package-lock.json`. `npm start` runs a managed launcher on port 5184 (`RENDERLAB_PORT` overrides it), and `vite preview` for browser tests uses 127.0.0.1:5194. Neither collides with RigLab (5180) or MapLab (5182).
