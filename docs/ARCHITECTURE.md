# Architecture

RenderLab is a standalone, game-engine-independent 2D presentation platform. It validates, compiles, loads and draws content exported by two independent authoring tools, MapLab (worlds) and RigLab (characters and animation), through PixiJS v8 on WebGL2 and WebGPU. A separate game or reference simulation owns authoritative state and hands RenderLab presentation snapshots. RenderLab never writes back into it. The [governing specification](specifications/2026-10-18-renderlab.md) is the full contract. This document records what the repository implements today and the boundaries it enforces.

## Current state

The repository holds its governance, toolchain and a reference application shell (`index.html`, `src/demo/ui/`). The shell is a React page that mounts no renderer yet. The renderer, asset pipeline and adapters arrive through the tasks in [implementation_plan.md](../implementation_plan.md), in specification order. Each task updates this document when it adds a boundary or module.

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
| `src/render/` | PixiJS v8 adapter, backends, terrain, sprites, skeletal, particles, effects, layers | RLDR-003 onward |
| `src/diagnostics/` | Metrics, profiling, visual parity | RLDR-017 to RLDR-020 |
| `src/demo/` | Reference application UI and scenes | RLDR-001 (shell), RLDR-018 |

## Dependency rules

These rules come from the specification's §5. RLDR-002 makes `npm run check` enforce the core rules mechanically; until then they bind every change by review.

- Core contracts never import PixiJS, React or DOM APIs.
- Simulation adapters never depend on the browser DOM.
- MapLab and RigLab adapters never import editor code.
- GPU-specific code stays inside renderer implementations.
- Asset validation stays independently testable.
- Browser UI never becomes gameplay authority, and instrumentation never affects deterministic state.
- React draws application UI only. Terrain, sprites and particles are renderer objects, never one React component each.

The repository contract already enforces the stack boundaries. RenderLab is React and TypeScript only, with no Rust, Cargo or Tauri. `pixi.js`, once added, must be an exact 8.x pin, and competing game or rendering engines (Phaser, three.js, Babylon.js, PlayCanvas and similar) are rejected.

## Toolchain

Node 26.10.0 and npm 12.1.0 are pinned, as are Vite 8, React 19, TypeScript 7, Vitest 5 for node-environment unit and contract tests, and Playwright 1.64 for Chromium and WebKit browser tests. Dependencies are exact versions locked by `package-lock.json`. `npm start` runs a managed launcher on port 5184 (`RENDERLAB_PORT` overrides it), and `vite preview` for browser tests uses 127.0.0.1:5194. Neither collides with RigLab (5180) or MapLab (5182).
