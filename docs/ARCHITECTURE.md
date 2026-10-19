# Architecture

RenderLab is a standalone, game-engine-independent 2D presentation platform. It validates, compiles, loads and draws content exported by two independent authoring tools, MapLab (worlds) and RigLab (characters and animation), through PixiJS v8 on WebGL2 and WebGPU. A separate game or reference simulation owns authoritative state and hands RenderLab presentation snapshots. RenderLab never writes back into it. The [governing specification](specifications/2026-10-18-renderlab.md) is the full contract. This document records what the repository implements today and the boundaries it enforces.

## Current state

The repository holds its governance, its toolchain, the renderer-neutral core contracts (`src/core/`, RLDR-002), the PixiJS v8 WebGL2 runtime (`src/render/`, RLDR-003) and the reference application (`index.html`, `src/demo/`). The application draws a generated reference scene through WebGL2 and shows the runtime's diagnostics. The renderer, asset pipeline and adapters arrive through the tasks in [implementation_plan.md](../implementation_plan.md), in specification order. Each task updates this document when it adds a boundary or module.

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
| `src/core/` | Renderer-neutral contracts: scene model, camera, timeline, lifecycle, capabilities | RLDR-002, RLDR-004, RLDR-005 |
| `src/assets/` | Bundle reading, integrity, loading, caching, atlases, compilation | RLDR-006, RLDR-007 |
| `src/adapters/` | MapLab and RigLab readers; the replaceable simulation bridge | RLDR-008, RLDR-011, RLDR-015 |
| `src/render/` | PixiJS v8 runtimes (WebGL2 since RLDR-003), backends, terrain, sprites, skeletal, particles, effects, layers | RLDR-003 onward |
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

`src/core/timeline/` holds the animation presentation state (clip, entry tick, facing, pause) and the `PresentationSnapshot` a game hands RenderLab each fixed tick (§14). `acceptSnapshot` validates a snapshot and returns a frozen copy, so presentation can never write back into game state. `src/core/camera/` holds the camera state that RLDR-005's camera math will drive.

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

`src/render/` implements `RendererRuntime` on PixiJS v8. The WebGL2 runtime presents sprites from a mounted scene, updates only what each delta dirties, and refuses content it cannot present yet. [GPU backends](GPU-BACKENDS.md) describes its context, texture, teardown and context-loss behaviour. The reference application (`src/demo/`) reaches PixiJS only through `src/render/`. It builds the runtime in a React effect and draws on `requestAnimationFrame`; React never holds scene objects.

## Dependency rules

These rules come from the specification's §5. `npm run check` enforces the first three mechanically: `scripts/check-boundaries.mjs` checks every module's imports, and `tsconfig.core.json` compiles `src/core/` with no DOM library and no Node types. The rest bind every change by review until their tasks add checks.

- Core contracts never import PixiJS, React or DOM APIs; `src/core/` imports only modules inside itself.
- PixiJS is imported only under `src/render/`, and React only under `src/demo/`.
- Simulation adapters never depend on the browser DOM.
- MapLab and RigLab adapters never import editor code.
- GPU-specific code stays inside renderer implementations.
- Asset validation stays independently testable.
- Browser UI never becomes gameplay authority, and instrumentation never affects deterministic state.
- React draws application UI only. Terrain, sprites and particles are renderer objects, never one React component each.

The repository contract already enforces the stack boundaries. RenderLab is React and TypeScript only, with no Rust, Cargo or Tauri. `pixi.js`, once added, must be an exact 8.x pin, and competing game or rendering engines (Phaser, three.js, Babylon.js, PlayCanvas and similar) are rejected.

## Toolchain

Node 26.10.0 and npm 12.1.0 are pinned, as are Vite 8, React 19, TypeScript 7, Vitest 5 for node-environment unit and contract tests, and Playwright 1.64 for Chromium and WebKit browser tests. Dependencies are exact versions locked by `package-lock.json`. `npm start` runs a managed launcher on port 5184 (`RENDERLAB_PORT` overrides it), and `vite preview` for browser tests uses 127.0.0.1:5194. Neither collides with RigLab (5180) or MapLab (5182).
