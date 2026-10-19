# Implementation plan

## Open tasks

The tasks below are the remaining baseline tasks reserved by the governing specification, [2026-10-18-renderlab.md](docs/specifications/2026-10-18-renderlab.md) §20, in its order. Each one is delivered by its own controlled PR. Before an adapter task, re-read the live `Wizard-Gang/MapLab` and `Wizard-Gang/RigLab` main branches (§3): their formats can change between sessions, and fixtures copied from them carry a provenance pin.

### RLDR-005 — [FEAT] Add the 2D camera and viewport

- Dependency: RLDR-004 (backend runtime); the math itself needs only RLDR-002.
- Why: Every world view needs one documented coordinate boundary (§8.4) and strict-pixel alignment (§10).
- Scope: `src/core/camera/` holds pure camera math in MapLab's X-right/Y-down world units: position, zoom, bounds clamping, smoothed follow, pixel snapping, screen↔world transforms, DPR, resize and aspect handling, an integer-scale strict-pixel policy, and optional seeded presentation-only shake. The render adapter applies the camera to the world container, and the demo gets pan and zoom controls.
- Non-goals: No parallax composition (RLDR-010) beyond a per-layer factor hook, no MapLab camera zones (RLDR-010), and no adaptive resolution (RLDR-017).
- Acceptance: Screen→world→screen round trips stay within the declared tolerance across zooms and DPRs. Strict-pixel mode produces only integer output scales and snapped positions. Bounds hold at every aspect ratio.
- Tests: Seeded Vitest property tests cover transforms, bounds and snapping. A Playwright test resizes, changes DPR and reads back a pixel grid.
- Validation: The standard set.
- Documentation: `docs/ARCHITECTURE.md` gains the coordinate conventions and the conversion boundary.
- Authorities: Specification §8.4, §10, §15.6 (pixel policy precedence); MapLab's coordinate contract on its live main.

### RLDR-006 — [FEAT] Read asset bundles with manifest and integrity checks

- Dependency: RLDR-005 in queue order; technically RLDR-002's resource handles.
- Why: Every MapLab, RigLab and compiled asset enters through one validated bundle reader (§8.1, §11.4, §12).
- Scope: `src/assets/` gets:
  - a bounded container reader for folder maps and STORE ZIPs, with safe-path, bounds and duplicate validation;
  - manifest parsing with size and SHA-256 verification;
  - contract-version and required-feature negotiation with actionable compatibility reports;
  - content-addressed resource identity and a reference-counted loading lifecycle.

  `fixtures/` gets a provenance lock (source repository, commit, path, SHA-256) for every copied MapLab or RigLab fixture, checked in `npm run check`.
- Non-goals: No MapLab or RigLab document semantics (RLDR-008, RLDR-011), no rasterization (RLDR-007), and no IndexedDB cache.
- Acceptance: Valid bundles load. The reader rejects, with precise reasons: corrupt bytes, size mismatches, unlisted, missing, duplicate or unsafe paths, unknown required features and unsupported versions. A correct digest is never treated as publisher identity.
- Tests: Vitest covers a corruption matrix, ZIP bounds (entry count, sizes, compression method) and lifecycle reference counting. A contract test covers the fixture lock.
- Validation: The standard set.
- Documentation: `docs/ASSET-PIPELINE.md` covers the bundle reader, integrity and identity.
- Authorities: Specification §8.1, §11.4–11.5, §12. On live main: MapLab's `schemas/maplab.export.v1.schema.json` and `conformance/bundle/`, and RigLab's export manifest in `src/export/bundle.ts`.

### RLDR-007 — [FEAT] Rasterize SVG artwork into deterministic texture atlases

- Dependency: RLDR-006 (bundles, identity, compiled manifest).
- Why: RigLab art is SVG and must become GPU textures without one texture per part (§10, §11.1–11.3).
- Scope: `src/assets/compilation/` and `src/assets/atlases/` provide:
  - SVG-to-raster compilation at an explicit resolution;
  - deterministic atlas packing, with padding and extrusion against bleeding, over multiple pages within device texture limits;
  - UV metadata keyed by stable asset IDs, and a nearest or linear filtering policy;
  - a compiled resource manifest (source identity, compiler version, settings, sizes, hashes, dimensions, required features) that records the rasterization toolchain.

  The rasterizer must stay React and TypeScript only. The browser's own SVG rasterization or a WebAssembly rasterizer are the candidates; choose one with evidence.
- Non-goals: No compressed GPU texture formats yet (evaluate only, §11.3), no baked character frames (RLDR-014), and no claim of cross-platform byte identity without evidence.
- Acceptance: The same inputs, compiler version and settings give identical atlas bytes in the declared environment. UVs land on the exact source rectangles. Pixel-art sources survive nearest sampling with no bleeding.
- Tests: Vitest covers packing determinism and UV validation. Playwright compares rasterization in Chromium and WebKit within the documented tolerance.
- Validation: The standard set.
- Documentation: `docs/ASSET-PIPELINE.md` covers rasterization, atlases, and the determinism guarantees and their limits.
- Authorities: Specification §10, §11. On RigLab's live main: its pixel-art and palette rules (`docs/SVGPIXELART.md`, `riglab.palette`).

### RLDR-008 — [FEAT] Adapt MapLab exports into the scene model

- Dependency: RLDR-007 in queue order; technically RLDR-006's bundle reader.
- Why: MapLab is the authority for world presentation (§3.1, §8).
- Scope: `src/adapters/maplab/` is an independent, editor-free reader for the live `maplab.export` v1 bundle and the documents it closes over. Map, tileset, prefab and catalog documents are read for presentation; movement and navigation are read as references only. It covers:
  - contract negotiation, schema validation and semantic reference validation;
  - dependency closure;
  - prefab-expanded visual placement with source traceability;
  - terrain chunk extraction and layers;
  - a source-ID-to-runtime-handle map.

  Fixtures are copied under the provenance lock from MapLab's committed example export and its `conformance/bundle` cases.
- Non-goals: No terrain batches (RLDR-009), no layer composition (RLDR-010), no collision or physics authority, and no imports from MapLab's `src/`.
- Acceptance: Supported MapLab fixture exports load into scenes with every source ID traceable. Unsupported required features or versions fail with an actionable report, and nothing required is dropped silently.
- Tests: Vitest runs over the pinned MapLab fixtures and their negative cases. A check proves `src/adapters/maplab/` imports no MapLab or editor code.
- Validation: The standard set.
- Documentation: `docs/INTEGRATION.md` gains the MapLab adapter section.
- Authorities: Specification §3.1, §3.3, §8. On MapLab's live main: `AGENTS.md`, `docs/FORMATS.md`, `schemas/`, `conformance/`, and `docs/specifications/2026-10-17-maplab-r1/` (F formats, G engine integration). MapLab's own export writer was still queued in its plan on 2026-10-18, so re-check its state first.

### RLDR-009 — [FEAT] Batch and cull sparse terrain chunks

- Dependency: RLDR-008 (MapLab terrain in the scene model).
- Why: Large worlds must render only what the camera needs, batched by shared textures (§8.2, §15.1–15.2).
- Scope: `src/render/terrain/` covers:
  - per-chunk GPU geometry from compiled atlases, preserving tile transforms and variants;
  - visible-chunk selection with preload margins, and chunk activation and deactivation;
  - dirty-chunk rebuilds that leave other chunks untouched;
  - eviction under a chunk budget;
  - draw-call and chunk diagnostics.

  Benchmark geometry batching against render-texture caching and record the choice.
- Non-goals: No parallax or foreground composition (RLDR-010), no particles, and no compressed textures.
- Acceptance: Reference terrain matches MapLab's tile placement and transforms. Only chunks inside the view plus its margin are submitted. Editing one chunk rebuilds only that chunk.
- Tests: Vitest covers culling and rebuild accounting. Playwright pixel checks cover tile transforms. The batching benchmark is recorded.
- Validation: The standard set.
- Documentation: `docs/PERFORMANCE.md` records the terrain batching decision and its evidence.
- Authorities: Specification §8.2, §12.4, §15.1–15.2.

### RLDR-010 — [FEAT] Compose MapLab visual layers, parallax and occlusion

- Dependency: RLDR-009 (terrain rendering), RLDR-005 (camera).
- Why: Draw order, parallax and foreground occlusion must follow MapLab's authored layer model (§8.3, §13).
- Scope: `src/render/layers/` covers:
  - authored layer order and parent relationships;
  - camera-bound parallax factors;
  - actor presentation planes, foreground occlusion and environment overlays;
  - camera zones and bounds from the export, and visual prefab handling;
  - PixiJS render groups and layers that separate static and dynamic content.

  Optional diagnostic overlays (colliders, footholds, spawns) are read-only.
- Non-goals: No fixed layer enumeration, no collision authority, and no characters (RLDR-012).
- Acceptance: Layer order matches the authored contract for every fixture. The parallax and camera-zone fixtures pass. Overlays are off by default and never feed back into data.
- Tests: Vitest covers order resolution. Playwright screenshots layered fixture views in both browsers.
- Validation: The standard set.
- Documentation: Layering goes in `docs/ARCHITECTURE.md`, and the MapLab mapping in `docs/INTEGRATION.md`.
- Authorities: Specification §8.3–8.6, §13; MapLab's layer and camera contracts on its live main.

### RLDR-011 — [FEAT] Adapt RigLab exports and baked frames

- Dependency: RLDR-010 in queue order; technically RLDR-006's bundle reader.
- Why: RigLab is the animation authority, and its baked transforms are authoritative presentation data (§3.2, §9.1, §9.3).
- Scope: `src/adapters/riglab/` is an independent reader for the live `riglab.export` v1 bundle: `riglab.rig` v1, `riglab.anim` v3, `riglab.weapon` v1 and `riglab.baked` v1. It validates:
  - versions and finite transforms;
  - bone, slot and weapon references;
  - frame counts against RigLab's 60 Hz kind timing;
  - resource bounds.

  It builds baked frame tables that include weapon body transforms. Fixtures come from an export of RigLab's `placeholder-library/`, pinned under the provenance lock.
- Non-goals: No IK or constraint solving, no rendering (RLDR-012), no art binding (RLDR-013), and no imports from RigLab's `src/` or its vendored Hexframe code.
- Acceptance: Supported RigLab exports load. Baked transforms reproduce the exported numbers exactly. Malformed or unsupported exports fail with precise reasons.
- Tests: Vitest runs over the pinned fixtures and a negative matrix, with exact-equality checks of baked frames.
- Validation: The standard set.
- Documentation: `docs/INTEGRATION.md` gains the RigLab adapter section.
- Authorities: Specification §3.2, §3.3, §9.1, §9.3–9.4. On RigLab's live main: `README.md`, `docs/ARCHITECTURE.md`, `src/format/` and `src/export/` (bundle and bake).

### RLDR-012 — [FEAT] Render articulated characters from baked frames

- Dependency: RLDR-011 (validated rig and baked frames).
- Why: Mode A articulated characters are the primary character renderer (§9.2, §9.5) and must show RigLab's motion exactly as RigLab previews it.
- Scope: `src/render/skeletal/` covers:
  - one sprite per rig part following the baked transforms, with the 11-part chibi as the reference;
  - fixed-tick frame playback: loops, one-shots, entry tick, seek, pause and restart;
  - facing composed from RigLab's facing-dependent depth profile, not a blind texture mirror;
  - RigLab's internal paint order;
  - textures and animation data shared across instances.

  Where an export lacks art, the placeholder art is clearly labelled.
- Non-goals: No skins, palettes or weapons beyond the placeholder art (RLDR-013), no baked sprite frames (RLDR-014), and no IK.
- Acceptance: The reference animations render. Part positions match the selected baked frames within the declared tolerance. Left-facing depth order matches RigLab's profile.
- Tests: Vitest covers frame selection and timing. Playwright screenshots poses facing each way.
- Validation: The standard set.
- Documentation: `docs/ARCHITECTURE.md` gains the character presentation section.
- Authorities: Specification §9.2–9.5, §9.7, §13 (sorting); RigLab's paint-order and depth rules on its live main.

### RLDR-013 — [FEAT] Bind skins, palettes, equipment and weapons

- Dependency: RLDR-012 (articulated characters), RLDR-007 (atlases).
- Why: Appearance must change freely without touching animation authority (§9.6, §9.7, §3.2: art is imported separately from RigLab exports).
- Scope: Covers:
  - binding independently imported, validated skin art to rig slots, with `riglab.palette` variants;
  - equipment overlays;
  - one- and two-handed weapons and multi-body weapons (such as paired daggers), placed by baked weapon body transforms at their authored grips;
  - RigLab's documented held-weapon paint order: held weapons, then their gripping forearms, draw over the head;
  - consistent left and right facing.
- Non-goals: No hitboxes inferred from art, no new art or animation formats, and no character-creation tools.
- Acceptance: Changing skin, palette or equipment never changes animation data. Grip positions match the baked weapon transforms. The paint-order tests pass.
- Tests: Vitest covers binding and validation. Playwright screenshots equipment variants facing each way.
- Validation: The standard set.
- Documentation: `docs/INTEGRATION.md` covers art, palette and weapon binding.
- Authorities: Specification §3.2, §9.6–9.7, §11.2. On RigLab's live main: its weapon, hold and palette formats, and the held-weapon paint-order rule.

### RLDR-014 — [FEAT] Add baked sprite frames and strict pixel-art mode

- Dependency: RLDR-013 (complete character appearance).
- Why: Mode B serves strict pixel art and large crowds from the same RigLab sources (§9.5, §10).
- Scope: Covers:
  - compiling whole-character poses into atlases from the same RigLab animation and art;
  - strict pixel mode: nearest sampling, integer scale, snapped positions, and stepped presentation (such as 12 unique poses per second over 60 Hz ticks);
  - switching between articulated and baked modes at runtime.
- Non-goals: No second animation format, and no change to simulation timing.
- Acceptance: Both modes derive from the same source animation. Pixel-art regression screenshots pass. Stepping never changes which simulation tick is presented.
- Tests: Vitest covers pose compilation determinism and stepping. Playwright takes pixel-art snapshots in both modes.
- Validation: The standard set.
- Documentation: `docs/ASSET-PIPELINE.md` (baked frames) and `docs/ARCHITECTURE.md` (pixel policy).
- Authorities: Specification §9.5, §10, §11.

### RLDR-015 — [FEAT] Bridge fixed-tick simulation snapshots to presentation

- Dependency: RLDR-014 in queue order; technically RLDR-002's snapshot contract and RLDR-012's playback.
- Why: The renderer must present game state without ever owning or changing it (§14).
- Scope: `src/adapters/simulation/` is a DOM-free synthetic 60 Hz reference state provider covering actor movement, animation changes, facing, traversal, spawn and despawn, and visual events. Add the snapshot interface, animation state selection by entry tick, and render-side interpolation limited to positions, the camera and allowed transforms. Prove that render cadence cannot change state.
- Non-goals: No physics, combat, AI or networking.
- Acceptance: 30, 60 and 144 Hz and irregular render cadences produce identical authoritative state hashes. The renderer has no write path into simulation data.
- Tests: Vitest runs determinism over cadences with a seeded provider. A check proves the provider uses no DOM APIs.
- Validation: The standard set.
- Documentation: `docs/INTEGRATION.md` covers the snapshot contract for consuming games.
- Authorities: Specification §4, §14, §5 (dependency rules).

### RLDR-016 — [FEAT] Add particles and backend-compatible effects

- Dependency: RLDR-015 (presentation events).
- Why: Impacts, dust, weather and trails are baseline presentation features on both backends (§15.4, §16).
- Scope: `src/render/particles/` and `src/render/effects/` cover pooled PixiJS particle containers with budgets, plus optional filters and shaders. Each shader ships GLSL ES and WGSL variants or a documented fallback.
- Non-goals: No compute shaders or WebGPU-only requirements.
- Acceptance: Effects work on both backends, and budgets are enforced.
- Tests: Vitest covers pooling and budgets. Playwright screenshots effects on each available backend.
- Validation: The standard set.
- Documentation: `docs/GPU-BACKENDS.md` covers shader variants and fallbacks.
- Authorities: Specification §15.4, §16 (shader architecture), §6.5.

### RLDR-017 — [FEAT] Add quality presets, adaptive resolution and GPU recovery

- Dependency: RLDR-016.
- Why: Predictable resources and safe recovery are baseline requirements (§12.3–12.4, §15.5–15.6, §17).
- Scope: Covers:
  - Low, Medium, High and Auto presets;
  - adaptive DPR with a target frame time, bounds, adjustment intervals, hysteresis, background-tab recovery, and the pixel policy taking precedence;
  - scene-scoped ownership of textures, atlases, render targets and filters, with shared reference counts;
  - WebGL context-loss and WebGPU device-loss handling: detect, stop issuing commands, reinitialize, and restore from presentation state;
  - lifecycle diagnostics.
- Non-goals: Quality presets never change gameplay geometry or behaviour.
- Acceptance: Removing scenes leaks no GPU resources. A forced context or device loss recovers with simulation state unchanged. Quality never alters gameplay state.
- Tests: Vitest covers the hysteresis and ownership models. Playwright forces context and device loss in each available backend.
- Validation: The standard set.
- Documentation: `docs/PERFORMANCE.md` (presets, adaptive resolution) and `docs/GPU-BACKENDS.md` (recovery).
- Authorities: Specification §12.3–12.4, §15.5–15.6, §17.

### RLDR-018 — [FEAT] Integrate the MapLab + RigLab reference demonstration

- Dependency: RLDR-017 (complete runtime).
- Why: A standalone application must show real MapLab worlds and RigLab characters together (§18, §24).
- Scope: Covers:
  - a side-scrolling world from pinned MapLab fixtures, with terrain, parallax and occlusion, and camera traversal;
  - RigLab actors with equipment, animation playback and effects;
  - backend, quality and presentation-mode controls;
  - the §18 diagnostic panel, with estimates labelled as estimates.

  No game server is involved, and placeholder content is labelled.
- Non-goals: No game rules, editors or servers.
- Acceptance: The demo runs standalone from `npm start` and from the built output, with no editor runtime dependency.
- Tests: Playwright drives the demo controls in Chromium and WebKit.
- Validation: The standard set.
- Documentation: The README and `docs/INTEGRATION.md` describe the demo.
- Authorities: Specification §18, §24.

### RLDR-019 — [TEST] Add browser visual regression across backends

- Dependency: RLDR-018 (scenes to capture).
- Why: Rendering must stay correct across browsers and backends (§19 visual regression).
- Scope: Playwright screenshot suites cover maps, poses, equipment, facing, pixel art, occlusion and particles, on WebGL2 and on WebGPU where available. Cross-backend comparisons use documented tolerances, with exact equality only where the contract and environment support it. A compatibility report lists unavailable capabilities.
- Non-goals: No silent skips. An unavailable capability is reported as unavailable.
- Acceptance: Supported environments pass the established tolerances, and unsupported ones are reported accurately.
- Tests: The suites themselves, plus a self-test of the comparison tolerances.
- Validation: The standard set.
- Documentation: `docs/TESTING.md` covers the visual regression policy.
- Authorities: Specification §17, §19.

### RLDR-020 — [PERF] Add the repeatable performance benchmark suite

- Dependency: RLDR-019.
- Why: Performance targets need recorded, reproducible evidence (§18 benchmark scenarios, §19 performance regression).
- Scope: Covers:
  - scenarios A–G;
  - average and P95 frame time, draw calls, texture uploads, memory estimates, scene load time, chunk rebuild time and recovery behaviour;
  - a benchmark identity of build SHA, browser, hardware and renderer;
  - a reproducibility protocol.

  Results are recorded as evidence files. Mobile device classes are owner-run measurements: a missing device class is recorded as missing, never passed.
- Non-goals: No unqualified machine-specific assertions in CI.
- Acceptance: Repeated runs reproduce within the documented variance, and every result carries a complete identity.
- Tests: Vitest covers metric aggregation. A smoke run of each scenario goes in Playwright.
- Validation: The standard set.
- Documentation: `docs/PERFORMANCE.md` covers the protocol and results.
- Authorities: Specification §15, §18, §19.

### RLDR-021 — [DOCS] Complete documentation and external integration acceptance

- Dependency: RLDR-020.
- Why: The baseline is complete only when a separate consumer can use RenderLab (§23, §24).
- Scope: Covers:
  - the final `docs/` set: ARCHITECTURE, ASSET-PIPELINE, GPU-BACKENDS, PERFORMANCE, INTEGRATION and TESTING;
  - a rendering API reference and the backend compatibility matrix;
  - a performance report built from RLDR-020's evidence;
  - an external consumer example that initializes RenderLab and shows validated MapLab and RigLab content without editor code;
  - the §23 checklist, with evidence for each item.
- Non-goals: No release or deployment. A release needs its own governed task.
- Acceptance: The consumer example passes in CI and canonical validation passes. Every §23 item has evidence or an explicitly documented gap.
- Tests: A consumer integration test, plus documentation link and evidence checks.
- Validation: The standard set.
- Documentation: The complete set.
- Authorities: Specification §20 (RLDR-021), §23, §24, §26.
