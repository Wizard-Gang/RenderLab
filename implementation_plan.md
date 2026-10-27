# Implementation plan

## Open tasks

The tasks below are the remaining baseline tasks reserved by the governing specification, [2026-10-18-renderlab.md](docs/specifications/2026-10-18-renderlab.md) §20, in its order. Each one is delivered by its own controlled PR. Before an adapter task, re-read the live `Wizard-Gang/MapLab` and `Wizard-Gang/RigLab` main branches (§3): their formats can change between sessions, and fixtures copied from them carry a provenance pin.

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
- Why: RigLab is the animation authority, and its baked transforms are authoritative presentation data (§3.2, §9.1, §9.3). RigLab's `docs/CONTRACTS.md` is the normative consumer contract this reader implements, checked against RigLab's published schemas and conformance fixtures (§3.3).
- Scope: `src/adapters/riglab/` is an independent reader for the `riglab-export/` bundle: `riglab.export` v2, `riglab.rig` v2, `riglab.anim` v3, `riglab.weapon` v1, `riglab.hold` v1 and `riglab.baked` v1. Following the contract's rules, it:
  - refuses any `format` or `version` it does not implement, and any member its schema does not name (R1);
  - checks every manifest entry's `bytes` and `sha256` against its file, hold files included, and refuses a manifest that names a file the bundle lacks (R2);
  - checks the cross-references each schema's `description` lists: bones, slots, pin and grip chains, and free and riding weapon bodies (R3);
  - accepts only RigLab's rig space (SVG units, x right, y down, clockwise-positive rotation), parent-relative bones and rotations in degrees (R4–R6);
  - checks `fps` 60, each kind's length and loop, and baked frame counts: `length` frames for a loop and `length + 1` for a one-shot (R11–R13);
  - reads the rig's resolved `paintOrder` (every profile, facing `right` and facing `left`, and `byClip`) unchanged for RLDR-012 (R18–R19);
  - applies resource bounds.

  It builds baked frame tables in the rig's bone order, with each frame's weapon `name` and body transforms or `null` (R14), and a tick sampler that shows frame `t mod length` for a loop and `min(t, length)` for a one-shot (R16). Fixtures are byte-exact copies of RigLab's committed `conformance/export/riglab-export/` bundle, the `conformance/invalid/` cases that target its formats, and `conformance/cases.json`. Each is recorded in `fixtures/provenance.json` against `Wizard-Gang/RigLab` commit `aae96a39f8710ae112e4c1cb0d18e2769e3ba3be`. Test helpers build no bundles.
- Non-goals: No IK, pin, grip or constraint solving, and no evaluating keys: baked frames are authoritative (R15). No rendering (RLDR-012), no skin or art reading (RLDR-013), and no imports from RigLab's `src/` or its vendored Hexframe code.
- Acceptance: The pinned conformance export loads. Every invalid case for these six formats fails at the `jsonPath` with the `reason` that `cases.json` names. Baked transforms reproduce the fixture numbers exactly. Each paint order reads back exactly as the rig stores it.
- Tests: Vitest runs over the pinned fixtures and checks each digest against `cases.json`. It runs the invalid-case matrix and checks the baked frames and the sampler with exact equality.
- Validation: The standard set; `check:fixtures` covers the new RigLab fixtures.
- Documentation: `docs/INTEGRATION.md` gains the RigLab adapter section, naming the implemented format versions and the pinned RigLab commit.
- Authorities: Specification §3.2, §3.3, §9.1, §9.3–9.4. RigLab at `aae96a3`: `docs/CONTRACTS.md` (R1–R6, R11–R16, R18–R19, V1–V4); `schemas/riglab.export.v2.schema.json`, `riglab.rig.v2`, `riglab.anim.v3`, `riglab.weapon.v1`, `riglab.hold.v1` and `riglab.baked.v1`; `conformance/README.md` and `conformance/cases.json`. Re-read RigLab's live main first. A format whose version changes after `aae96a3` (V1, V3) re-pins this task.

### RLDR-012 — [FEAT] Render articulated characters from baked frames

- Dependency: RLDR-011 (validated rig, paint orders and baked frames).
- Why: Mode A articulated characters are the primary character renderer (§9.2, §9.5) and must show RigLab's motion and paint order exactly as RigLab previews them.
- Scope: `src/render/skeletal/` covers:
  - one sprite per rig part, following the baked transforms, with the conformance export's 11-bone chibi as the reference;
  - fixed-tick playback through RLDR-011's sampler, with loops, one-shots, entry tick, seek, pause and restart. Presentation may interpolate between baked frames but never changes tick timing (R17);
  - paint order from the rig's resolved `paintOrder`. The profile is `byClip[<animation>]`, else `byClip[<class>]`, else `depthProfiles.default` (R19). The facing's own `right` or `left` list, back to front, is the draw order (R18). RenderLab does not reimplement Hexframe's `visualPaintOrder`, and it never derives the left order by mirroring the right;
  - shared textures and animation data across instances.

  Where an export lacks art, the placeholder art is clearly labelled.
- Non-goals: No skins, palettes or weapons beyond the placeholder art (RLDR-013), no baked sprite frames (RLDR-014), no IK, and no depth or paint-order resolution in RenderLab.
- Acceptance: The conformance animations render. Part positions match the selected baked frames within the declared tolerance. For every profile and facing, draw order equals the rig's `paintOrder` list exactly: `chibi.rig.json`'s `anatomical` right and left orders differ, and `sword-attack` uses `both-front`.
- Tests: Vitest covers frame selection, timing, and profile and order selection against the pinned rig. Playwright screenshots poses facing each way.
- Validation: The standard set.
- Documentation: `docs/ARCHITECTURE.md` gains the character presentation section.
- Authorities: Specification §9.2–9.5, §9.7, §13 (sorting). RigLab at `aae96a3`: `docs/CONTRACTS.md` R15–R19, and `schemas/riglab.rig.v2.schema.json` (`$defs.paint-order`, `$defs.facing-orders`).

### RLDR-013 — [FEAT] Bind skins, palettes, equipment and weapons

- Dependency: RLDR-012 (articulated characters), RLDR-007 (atlases).
- Why: Appearance must change freely without touching animation authority (§9.6, §9.7, §3.2: art is imported separately from RigLab exports). RigLab's export is pixel-only; vector art is editor-only in RigLab (R10).
- Scope: Covers:
  - an independent reader for the `riglab-skins/` bundles (`skins/<name>/` and `weapons/<name>/`): `riglab.skin` v1 manifests, their `riglab.palette` v1 `palette.json` and their `riglab.part` v1 pixel grids. It checks closed documents and `bytes` and `sha256` pins (R1–R2), the grid shape (R9), one part per rig bone in bone order with its slot, and one per weapon body in body order, where bodies that share a slot share a file (R21);
  - each pixel's style from its key's class tokens, cascaded in the palette's `classes` member order (R22). A `pixel: true` palette draws whole cells with crisp edges, with no strokes or smoothing (R23);
  - binding parts to bones: each pixel is a 2 × 2 rig-unit cell placed from the part's `origin` and drawn at its bone's world transform (R7–R8), packed into RLDR-007 atlases;
  - palette variants and equipment overlays;
  - one- and two-handed weapons and multi-body weapons, placed by the baked weapon body transforms at their authored grips. The sword has one free body gripped by both hands; the daggers have one riding body per hand;
  - held-weapon paint order from `paintOrder.held` (R20): the figure in profile order without the gripping forearms, then every weapon body in body order, then the gripping forearms in profile order;
  - consistent left and right facing.

  Fixtures are byte-exact copies of RigLab's `conformance/export/riglab-skins/` bundles and the skin, palette and part `invalid/` cases, under the same `fixtures/provenance.json` pin to `aae96a3`.
- Non-goals: No vector or SVG art from RigLab, which never exports it (R10). No hitboxes inferred from art, no new art or animation formats, and no character-creation tools.
- Acceptance: Changing skin, palette or equipment never changes animation data. The pinned skin bundles load. Every `riglab.skin`, `riglab.palette` and `riglab.part` invalid case fails at its named `jsonPath` and `reason`. Pixels land on the cells R8 gives. Grip positions match the baked weapon transforms. The held-weapon paint-order tests pass.
- Tests: Vitest covers bundle validation, the class cascade, pixel placement and binding. Playwright screenshots equipment variants facing each way.
- Validation: The standard set; `check:fixtures` covers the new skin fixtures.
- Documentation: `docs/INTEGRATION.md` covers art, palette and weapon binding.
- Authorities: Specification §3.2, §9.6–9.7, §11.2. RigLab at `aae96a3`: `docs/CONTRACTS.md` R1–R3, R7–R10 and R20–R23; `schemas/riglab.skin.v1.schema.json`, `riglab.palette.v1`, `riglab.part.v1`, `riglab.weapon.v1` and `riglab.hold.v1`; `conformance/export/riglab-skins/` and `conformance/cases.json`.

### RLDR-014 — [FEAT] Add baked sprite frames and strict pixel-art mode

- Dependency: RLDR-013 (complete character appearance).
- Why: Mode B serves strict pixel art and large crowds from the same RigLab sources (§9.5, §10).
- Scope: Covers:
  - compiling whole-character poses into atlases from the same baked frames, pixel parts and paint orders;
  - strict pixel mode, which uses the `riglab.part` grids directly: one texel per grid pixel, scaled 2 rig units per pixel and offset by each part's `origin` (R7–R8). It uses nearest sampling, integer scale, snapped positions and crisp cells (R23), with stepped presentation (such as 12 unique poses per second over 60 Hz ticks);
  - switching between articulated and baked modes at runtime.
- Non-goals: No second animation format, no SVG rasterization of RigLab art, and no change to simulation timing.
- Acceptance: Both modes derive from the same baked frames and grids. An unrotated strict-mode part at integer scale matches its grid pixel for pixel. Pixel-art regression screenshots pass. Stepping never changes which simulation tick is presented.
- Tests: Vitest covers pose compilation determinism, grid placement and stepping. Playwright takes pixel-art snapshots in both modes.
- Validation: The standard set.
- Documentation: `docs/ASSET-PIPELINE.md` (baked frames and pixel grids) and `docs/ARCHITECTURE.md` (pixel policy).
- Authorities: Specification §9.5, §10, §11. RigLab at `aae96a3`: `docs/CONTRACTS.md` R7–R8, R11, R16–R17 and R23, and `schemas/riglab.part.v1.schema.json`.

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
