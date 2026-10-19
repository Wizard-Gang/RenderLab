# RenderLab — GPU-Native 2D Game Renderer
## Architecture & Implementation Specification

**Organization:** Wizard-Gang\
**Project:** RenderLab\
**Language:** TypeScript\
**Rendering Library:** PixiJS v8\
**Graphics APIs:** WebGL2 + WebGPU\
**Asset Sources:** MapLab + RigLab\
**Target Platforms:** Desktop and mobile web browsers\
**Architecture:** Standalone, renderer-focused, game-engine independent\
**Status:** Initial implementation baseline

---

# 1. Project Objective

Build RenderLab, a reusable, GPU-accelerated 2D rendering platform for browser-based games.

RenderLab will use PixiJS v8 to provide high-performance rendering across WebGL2 and WebGPU while consuming assets produced by two independent authoring applications:

- **MapLab:** World creation, terrain, tilemaps, visual layers, parallax, and map presentation.
- **RigLab:** Character skeletons, animations, skins, equipment, weapons, and visual composition.

RenderLab must remain independent of any particular game, simulation engine, combat system, physics implementation, or multiplayer architecture.

The goal is to establish a long-term rendering foundation that supports visually rich side-scrolling games, including large worlds, animated characters, dynamic equipment, particle effects, and strict pixel-art presentation.

The first deliverable is a standalone rendering application and benchmark environment demonstrating actual MapLab and RigLab asset integration.

This project is not a complete game engine.

## Core objectives

1. Establish PixiJS v8 as the primary rendering library.
2. Support WebGL2 and WebGPU through a shared presentation interface.
3. Use WebGL2 as the initial production baseline.
4. Develop and validate WebGPU as a future primary backend.
5. Consume versioned MapLab and RigLab export bundles.
6. Compile authored assets into efficient GPU-ready resources.
7. Support articulated character rendering and baked sprite animations.
8. Provide consistent pixel-art rendering.
9. Support large scrolling environments through chunk-based rendering.
10. Maintain deterministic separation between simulation and presentation.
11. Minimize unnecessary CPU work, GPU submissions, and memory consumption.
12. Provide extensive diagnostics, benchmarking, and visual-regression testing.
13. Remain portable across browsers, operating systems, and device classes.
14. Establish a reusable rendering API for independently developed games.

## Design philosophy

**Author once. Compile once. Render anywhere.**

MapLab and RigLab remain the authoritative sources for authored content.

RenderLab validates, compiles, loads, and presents that content.

The game engine controls authoritative state.

The GPU renderer controls only visual presentation.

---

# 2. Technology Stack

## Required technologies

| Component | Technology |
|---|---|
| Language | TypeScript |
| Rendering framework | PixiJS v8 |
| Production graphics | WebGL2 |
| Advanced graphics | WebGPU |
| Development server | Vite |
| Application UI | React + TypeScript |
| Asset formats | Versioned JSON + SVG + raster textures |
| Character animation | RigLab exported animations and baked transforms |
| Map presentation | MapLab exported worlds and tilesets |
| Testing | Vitest |
| Browser testing | Playwright |
| Build system | Node.js + npm |
| Asset integrity | SHA-256 |
| Browser cache | HTTP cache / IndexedDB where appropriate |

Use the repository-standard pinned Node.js and npm versions.

Pin the actual selected PixiJS v8 release and its transitive dependency lockfile.

Avoid unnecessary dependencies and avoid introducing a second game engine.

## Renderer selection

PixiJS v8 is the selected rendering library.

RenderLab must not reimplement capabilities already provided adequately by PixiJS, including:

- Sprite rendering
- Texture management
- Graphics primitives
- Mesh rendering
- Asset bundles
- Render layers
- Render groups
- Particle containers
- Filters
- Core batching
- Renderer initialization
- Renderer resource lifecycle

Custom rendering systems are justified only where MapLab/RigLab requirements or measured performance demonstrate a need.

---

# 3. External Integration Authorities

Before implementing adapters, inspect the current main branches of:

- `Wizard-Gang/MapLab`
- `Wizard-Gang/RigLab`

Read their current:

- AGENTS.md
- README.md
- ARCHITECTURE.md
- Relevant format specifications
- Export contracts
- Export manifests
- JSON Schemas
- Example exports
- Conformance fixtures
- Rendering and animation code
- Integration requirements

Do not assume specifications remain unchanged between implementation sessions.

## 3.1 MapLab authority

MapLab owns authored world data.

Relevant format families include:

- `maplab.export` v1
- `maplab.map` v1
- `maplab.tileset` v1
- `maplab.prefab` v1
- `maplab.movement` v1
- Associated catalog, navigation, and dependency contracts

The live repository is the authority for exact format names, versions, and field definitions.

RenderLab must respect:

- Orthogonal side-view worlds
- X-right/Y-down coordinates
- World units and coordinate quantization
- Sparse 32×32 terrain chunks
- Explicit visual layers
- Parallax relationships
- Foreground occlusion
- Actor presentation planes
- Stable source IDs
- Prefab-expanded world presentation
- Camera and environment zones
- Dependency-closed export bundles
- Export integrity hashes
- Explicit unsupported-feature handling

MapLab's collision geometry, footholds, navigation, movement profiles, triggers, and entity definitions may be imported as references where necessary for presentation, but RenderLab must not become their simulation authority.

## 3.2 RigLab authority

RigLab owns authored skeletons, animations, weapon rigs, constraints, and their export semantics.

Relevant formats include:

- `riglab.export` v1
- `riglab.rig` v1
- `riglab.anim` v3
- `riglab.weapon` v1
- `riglab.baked` v1

RenderLab must respect:

- Parent-relative skeleton transforms
- Existing 11-part chibi rigs
- Source bone lengths and proportions
- Rig coordinate conventions
- 60 Hz animation timing
- Animation looping and one-shot behavior
- Authored interpolation semantics
- Baked bone transforms
- Weapon body transforms
- Hand grips and constraints
- Facing and depth profiles
- Visual paint order
- Separately managed SVG artwork and palettes

RigLab's exported baked transforms must be treated as authoritative presentation data.

Do not write a second inverse-kinematics solver for the normal rendering path.

RigLab exports do not currently contain all character SVG artwork and skin assets. RenderLab must support independently imported and validated art resources.

## 3.3 Independence requirements

Neither authoring application depends on RenderLab.

RenderLab consumes their exported artifacts, not their editor interfaces.

Do not import editor state, undo/redo logic, document storage adapters, tool panels, or editing workflows into the runtime.

If common format packages are published in the future, RenderLab may consume their versioned, editor-free interfaces.

Until then, use independent readers against published schemas, manifests, and conformance fixtures.

---

# 4. High-Level Architecture

```text
                       AUTHORING
              +-----------------------+
              |                       |
         +----v-----+           +-----v----+
         |  MapLab  |           |  RigLab  |
         |          |           |          |
         |  Worlds  |           |  Rigs    |
         |  Terrain |           |  Motion  |
         |  Tiles   |           |  Weapons |
         |  Layers  |           |  Skins   |
         +----+-----+           +-----+----+
              |                       |
              v                       v
         Map Export                Rig Export
              |                       |
              +-----------+-----------+
                          |
                          v
               +---------------------+
               | Asset Validation    |
               | Integrity Checking  |
               | Format Negotiation  |
               +----------+----------+
                          |
                          v
               +---------------------+
               | Asset Compilation   |
               |                     |
               | Texture Atlases     |
               | Terrain Batches     |
               | Character Sprites   |
               | Baked Frames        |
               | Resource Manifests  |
               +----------+----------+
                          |
                          v
               +---------------------+
               | RenderLab Runtime   |
               |                     |
               | Scene Management    |
               | Camera              |
               | Layers              |
               | Animation           |
               | Presentation State  |
               +----------+----------+
                          |
                          v
               +---------------------+
               | PixiJS v8 Adapter   |
               +----------+----------+
                          |
                  +-------+-------+
                  |               |
                  v               v
              +--------+     +--------+
              | WebGL2 |     | WebGPU |
              +----+---+     +---+----+
                   |             |
                   +------+------+
                          |
                          v
                     Browser GPU
```

A separate game or reference simulation supplies entity state.

```text
        Independent Game Runtime
                 |
                 v
        Presentation Snapshot
                 |
                 v
        RenderLab Scene Runtime
                 |
                 v
             PixiJS v8
```

The renderer must never modify authoritative simulation state.

---

# 5. Repository Architecture

Create a standalone repository named `RenderLab`.

Recommended structure:

```text
RenderLab/
├── .github/
│   └── workflows/
├── AGENTS.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── README.md
├── implementation_plan.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
│
├── src/
│   ├── core/
│   │   ├── contracts/
│   │   ├── scene/
│   │   ├── camera/
│   │   ├── timeline/
│   │   ├── lifecycle/
│   │   └── capabilities/
│   │
│   ├── assets/
│   │   ├── manifests/
│   │   ├── integrity/
│   │   ├── loading/
│   │   ├── caching/
│   │   ├── atlases/
│   │   └── compilation/
│   │
│   ├── adapters/
│   │   ├── maplab/
│   │   ├── riglab/
│   │   └── simulation/
│   │
│   ├── render/
│   │   ├── pixi/
│   │   ├── backends/
│   │   ├── terrain/
│   │   ├── sprites/
│   │   ├── skeletal/
│   │   ├── particles/
│   │   ├── effects/
│   │   └── layers/
│   │
│   ├── diagnostics/
│   │   ├── metrics/
│   │   ├── profiling/
│   │   └── visual-parity/
│   │
│   └── demo/
│       ├── scenes/
│       ├── controls/
│       └── ui/
│
├── tests/
│   ├── contracts/
│   ├── assets/
│   ├── render/
│   ├── browser/
│   └── performance/
│
├── fixtures/
│   ├── maplab/
│   ├── riglab/
│   └── expected/
│
├── scripts/
│
└── docs/
    ├── ARCHITECTURE.md
    ├── ASSET-PIPELINE.md
    ├── GPU-BACKENDS.md
    ├── PERFORMANCE.md
    ├── INTEGRATION.md
    └── TESTING.md
```

## Architectural dependency rules

- Core contracts must not import PixiJS.
- Core contracts must not import React.
- Simulation adapters must not depend on the browser DOM.
- MapLab and RigLab adapters must not import editor code.
- GPU-specific code must remain inside renderer implementations.
- Asset validation must be independently testable.
- The reference simulation must be replaceable.
- Browser UI must not become gameplay authority.
- Performance instrumentation must not affect deterministic state.

Favor small, explicit modules over large general-purpose abstractions.

---

# 6. Graphics Backend Architecture

RenderLab supports two GPU backends through PixiJS v8.

## 6.1 Backend modes

Expose:

```ts
type RendererBackend =
  | "auto"
  | "webgl2"
  | "webgpu";
```

Initial behavior:

- `webgl2`: Require WebGL2 and report an unsupported configuration if unavailable.
- `webgpu`: Attempt WebGPU and report initialization failures.
- `auto`: Initially prefer WebGL2 until WebGPU production qualification is complete.

Allow backend selection in the demo application.

A later governed change may make WebGPU the preferred automatic backend.

## 6.2 Backend abstraction

Define a renderer-neutral lifecycle contract.

Conceptually:

```ts
interface RendererRuntime {
  initialize(): Promise<void>;
  mountScene(scene: SceneDefinition): Promise<void>;
  update(snapshot: PresentationSnapshot): void;
  render(alpha: number): void;
  resize(width: number, height: number, dpr: number): void;
  getDiagnostics(): RendererDiagnostics;
  destroy(): Promise<void>;
}
```

Treat this as an initial interface proposal, not a replacement for the concrete contracts established during implementation.

The public interface must not expose PixiJS implementation details unnecessarily.

## 6.3 Capability detection

Detect:

- WebGL2 availability
- WebGPU availability
- Required GPU features and limits
- Texture-size limits
- Supported texture formats
- Device pixel ratio
- Reduced-motion preference
- Rendering initialization failures

Capability probing must be performed against actual browser/device support.

Do not use user-agent strings as the primary renderer capability authority.

WebGPU requires a secure context in production.

## 6.4 Backend fallback

If WebGPU initialization fails:

1. Capture the failure reason.
2. Release partially created resources.
3. Attempt WebGL2 initialization when fallback is permitted.
4. Restore the presentation scene.
5. Report the selected backend in diagnostics.

Do not silently downgrade a mode explicitly requiring WebGPU.

Recovery must preserve game or reference simulation state.

## 6.5 Backend parity

Both backends must support the baseline presentation features.

Test:

- Texture sampling
- Sprite transforms
- Transparency
- Alpha blending
- Color consistency
- Z-order and depth sorting
- Layer composition
- Camera transforms
- Animation playback
- Pixel-art filtering
- Filters and shaders
- Resize behavior
- Asset disposal and recovery

Custom shader effects must provide implementations compatible with both backends or a documented equivalent fallback.

WebGPU-only optimizations must never become mandatory for gameplay correctness.

---

# 7. Renderer-Neutral Scene Model

Define an intermediate 2D presentation representation.

The scene model describes what should appear, not how the GPU draws it.

Conceptually, it includes:

- Scene identifiers
- Visual layers
- Cameras
- Static terrain
- Tile chunks
- Sprites
- Animated characters
- Props
- Particles
- Visual effects
- Visibility
- Sorting relationships
- Resource references

## Requirements

The scene model must:

1. Avoid graphics-backend-specific objects.
2. Preserve source asset identifiers.
3. Support efficient incremental changes.
4. Distinguish static and dynamic objects.
5. Support dirty-region or dirty-chunk updates.
6. Avoid rebuilding the full scene for individual changes.
7. Permit deterministic presentation snapshots.
8. Support multiple scenes without shared mutable state leakage.

The renderer translates this representation into PixiJS objects and GPU resources.

Do not construct a separate React component for every terrain tile, sprite, or particle.

React is appropriate for application UI, not bulk per-frame rendering.

---

# 8. MapLab Asset Integration

MapLab is the authoritative source of world presentation.

## 8.1 Export ingestion

Implement an importer for supported MapLab export bundles.

Required sequence:

1. Read export container.
2. Validate file paths and bounds.
3. Reject duplicate or unsafe entries.
4. Parse the export manifest.
5. Verify listed sizes and SHA-256 hashes.
6. Check required contract versions and features.
7. Validate documents against their schemas.
8. Validate semantic references.
9. Resolve dependency closure.
10. Build the renderable scene representation.
11. Preserve the source-ID-to-runtime-handle mapping.

Unknown required features must fail with an actionable compatibility report.

Do not silently discard required content.

A correct SHA-256 digest establishes consistency with a manifest, not the identity or trustworthiness of the publisher.

## 8.2 Terrain rendering

MapLab uses sparse 32×32 terrain chunks.

RenderLab must preserve this organization and compile the authored terrain into efficient GPU-friendly data.

Required capabilities:

- Visible-chunk selection
- Chunk-level batching
- Texture-atlas references
- Tile transformations
- Tile variants
- Chunk caching
- Incremental dirty-chunk rebuilding
- Offscreen chunk culling
- Predictive nearby-chunk loading
- Explicit resource unloading

Avoid creating an expensive independent render hierarchy for every tile.

Static tile geometry should be grouped into batches with shared textures and compatible shaders.

Do not assume every chunk must be rendered into an intermediate texture.

Benchmark geometry batching against render-texture caching before selecting either for a workload.

## 8.3 World layers

Support MapLab-authored visual layers, including:

- Background layers
- Parallax backgrounds
- Terrain layers
- Decoration layers
- Actor presentation planes
- Foreground layers
- Occlusion relationships
- Environment overlays

The runtime must respect authored ordering and parent relationships.

Do not replace MapLab's layer model with a rigid, incompatible enumeration.

## 8.4 Side-scrolling camera

Implement a 2D camera supporting:

- Position
- Zoom
- Follow targets
- Camera bounds
- Smooth visual following
- Pixel snapping
- Parallax offsets
- Viewport resizing
- Different aspect ratios
- Camera-zone overrides
- Optional camera shake
- Screen-to-world conversion
- World-to-screen conversion

The camera uses the same coordinate convention as the imported presentation model.

Any conversion must happen at a documented boundary.

## 8.5 Collision separation

MapLab's visual terrain is not automatically physical terrain.

RenderLab may expose collision geometry for debugging, but it must not derive authoritative collision from rendered pixels.

Required boundary:

```text
MapLab Visual Data --> RenderLab
MapLab Physics Data --> Game Engine

Game Engine State --> RenderLab
```

The renderer may visually display:

- Collider outlines
- Footholds
- Navigation routes
- Actor anchors
- Waypoints
- Spawn locations

These must remain optional diagnostic overlays.

## 8.6 Prefabs and source IDs

Preserve stable IDs throughout import and rendering.

Prefab-expanded assets must retain traceability to their source definitions where the export supplies that information.

Use stable IDs for:

- Dynamic visual updates
- Visibility changes
- Resource references
- Debug overlays
- Scene inspection
- Rebuildable presentation handles

RenderLab must not generate new authoritative world identities.

---

# 9. RigLab Asset Integration

RigLab is the authoritative source for skeletal character animation.

## 9.1 Rig import

Consume validated RigLab export bundles.

Support:

- Skeleton hierarchy
- Bone transforms
- Art slots
- Attachment points
- Animation definitions
- Baked animation data
- Weapon body transforms
- Facing and depth profiles
- Rig metadata

The importer must validate version compatibility, finite transforms, references, frame counts, and resource bounds.

## 9.2 Primary character renderer

Implement articulated GPU sprite characters.

A character is composed from independently textured parts following the RigLab skeleton.

The initial reference rig contains 11 parts.

Each part must support:

- Texture or atlas-region assignment
- Parent-relative transforms
- Rotation
- Translation
- Scale from the declared presentation mapping
- Depth ordering
- Color or palette variants
- Visibility
- Equipment overlays

Character transforms come from RigLab's authored or baked presentation.

## 9.3 Baked transforms

Use `riglab.baked` v1 to obtain solved bone and weapon transforms.

The runtime should not independently solve hand grips, pinned feet, or inverse kinematics merely to draw a baked clip.

Use the exported frame data to present the authored motion.

Benefits:

- Consistency with RigLab preview
- Reduced per-character CPU work
- Deterministic frame playback
- No competing rig solver
- Portable animation output

Do not round or modify the authored transforms in a way that changes animation semantics.

## 9.4 Animation timing

RigLab animations use 60 Hz authored timing.

Animation sampling must follow the published RigLab and MapLab integration contracts.

Support:

- Loops
- One-shot clips
- State-entry timing
- Frame seeking
- Pausing
- Restarting
- Playback synchronization
- Declared animation fallbacks
- Fixed-tick sampling

Rendering may interpolate presentation frames where allowed, but must not modify simulation timing.

## 9.5 Character presentation modes

Implement two modes.

### Mode A: Articulated textured sprites

Render individual character parts with GPU transforms.

Best suited for:

- Modular equipment
- Dynamic weapons
- Recolorable armor
- Skins
- Reusable rig animation
- High-detail character presentation

### Mode B: Baked sprite frames

Compile complete rendered character poses into sprite atlases.

Best suited for:

- Strict pixel art
- Stepped animation
- Repeated actors
- Large crowds
- Lower runtime pose-processing overhead

Both modes must derive from the same RigLab source assets.

Do not create a second animation authoring format.

## 9.6 Weapons and attachments

Support RigLab-authored weapon rigs and their baked transforms.

Requirements:

- One-handed equipment
- Two-handed equipment
- Multiple weapon bodies
- Authored grip positions
- Correct equipment orientation
- Correct weapon depth
- Consistent left/right facing
- Skin and weapon combinations

Preserve RigLab's existing rule that held weapon art and gripping hands use the documented paint ordering.

Never infer authoritative weapon hitboxes from rendered artwork.

## 9.7 Facing and depth

Facing left must not be implemented solely as an unconditional texture mirror.

Respect RigLab's facing-dependent depth profiles and paint order.

This is especially important for:

- Overlapping arms
- Weapons passing above the head
- Hands gripping weapons
- Front/back legs
- Equipment covering body parts

Mirroring and depth composition must be independently correct.

---

# 10. Pixel-Art Rendering

Pixel art is a first-class rendering mode.

RenderLab must support crisp, consistent pixel presentation without introducing accidental smoothing.

## Requirements

- Nearest-neighbor texture sampling
- Lossless art where necessary
- Uniform source pixel grids
- Integer scaling in strict-pixel mode
- Camera snapping
- Pixel-aligned static artwork
- Atlas padding
- Prevention of texture bleeding
- Configurable frame stepping
- Consistent pixel dimensions
- Explicit rasterization resolution

## Vector and pixel separation

RigLab authors SVG artwork.

RenderLab may rasterize that artwork into GPU textures during asset compilation.

Support two visual policies:

### Smooth mode

- SVG-derived artwork rasterized at suitable resolution
- Smooth filtering where appropriate
- Flexible scaling
- Continuous articulated motion

### Strict pixel mode

- Grid-aligned source artwork
- Nearest-neighbor sampling
- Integer output scaling
- Quantized visual positioning where appropriate
- Stepped frame presentation
- Baked poses when necessary

Rotating a sprite by arbitrary angles does not guarantee square, uniform pixels.

If strict pixel consistency is required, use pre-rasterized poses or a deliberately quantized pose pipeline.

## Animation stepping

Separate simulation frequency from unique visual-frame frequency.

For example:

```text
Simulation:        60 ticks/second
Display refresh:   60 frames/second
Art presentation:  12 unique poses/second
```

Simulation accuracy remains unchanged.

The renderer displays the most appropriate authored or baked pose according to its presentation policy.

This supports classic pixel-art animation without sacrificing simulation determinism.

---

# 11. Asset Compilation Pipeline

Establish a deterministic compilation process that transforms authored content into GPU-ready resources.

## Inputs

- MapLab export bundles
- RigLab export bundles
- SVG character artwork
- Skin palettes
- Weapon artwork
- Terrain textures
- Optional visual-effect artwork

## Outputs

- Validated runtime manifest
- Texture atlases
- Atlas UV coordinates
- Sprite metadata
- Compiled terrain batches
- Rig presentation metadata
- Baked sprite frames where requested
- Resource dependencies
- Asset hashes
- Resource-size information

## 11.1 Deterministic compilation

Given identical source assets, compiler version, and settings, produce identical output bytes wherever the compilation contract guarantees determinism.

Record the toolchain used for outputs involving rasterization.

Do not claim cross-platform byte identity until it has been tested across supported build environments.

## 11.2 Texture atlases

Atlas compilation must:

- Pack compatible artwork
- Preserve source dimensions
- Record UV coordinates
- Use stable asset identifiers
- Prevent texture bleeding
- Support multiple atlas pages
- Respect device texture limits
- Support appropriate filtering modes
- Support deterministic cache identities

Do not require one GPU texture per SVG body part.

## 11.3 Texture formats

Support standard lossless raster images.

Evaluate compressed GPU texture formats for larger environmental artwork.

Use compressed textures only where the supported backends and devices can decode them correctly.

Maintain uncompressed fallbacks where necessary.

Strict pixel art must not be degraded by lossy compression.

## 11.4 Manifest integrity

The compiled resource manifest must record:

- Source bundle identity
- Compiler version
- Asset IDs
- Dependency references
- File sizes
- Content hashes
- Texture dimensions
- Required renderer features
- Compilation settings

Derived presentation resources must remain rebuildable.

Never mutate the source export bundles during compilation.

## 11.5 Version handling

Format compatibility must be explicit.

Reject unsupported required contract versions.

Never silently reinterpret unknown fields or older semantics.

Format migrations, when necessary, must be separate, versioned, tested operations.

---

# 12. Runtime Asset Management

Use PixiJS asset management wherever appropriate.

## 12.1 Loading strategy

Implement:

- Initial scene loading
- Asset bundles
- Asynchronous loading
- Progressive scene readiness
- On-demand content loading
- Nearby-chunk preloading
- Character asset reuse
- Scene transition loading
- Explicit error reporting

Avoid downloading an entire game's asset library on initial page load.

## 12.2 Caching

Support:

- Browser HTTP caching
- Content-addressed resource reuse
- In-memory atlas caches
- Optional persistent compiled-asset caching
- Reference counting
- Cache invalidation
- Resource eviction

Use IndexedDB only where persistent caching materially improves the workflow.

Cache identity must include relevant source hashes and compiler version.

## 12.3 Memory management

Implement explicit lifecycle ownership for:

- Textures
- Atlases
- Buffers
- Render targets
- Sprite containers
- Filters
- Scene-specific resources

Ensure removing a scene does not leak GPU resources.

Shared assets must not be released while another scene still references them.

## 12.4 Resource budgets

Support configurable budgets for:

- Texture memory
- Loaded terrain chunks
- Particle counts
- Render targets
- Cached scenes
- Preloaded assets

Use hardware and runtime measurements to determine practical defaults.

Do not assume all mobile devices have the same available memory.

---

# 13. Scene Graph and Layering

Establish a renderer-neutral layer and presentation model.

The baseline should support:

1. Distant backgrounds
2. Parallax backgrounds
3. Back terrain
4. World decorations
5. Actor presentation planes
6. Foreground scenery
7. Occlusion effects
8. World-space particles
9. Screen-space effects
10. HUD and application overlays

Actual draw order must respect MapLab's authored layer structure.

## Render grouping

Use PixiJS render groups and render layers where beneficial.

Avoid unnecessary scene traversal and transform recalculation.

Separate:

- Static environment
- Moving actors
- Animated props
- Particles
- Screen-space effects
- Application UI

## Sorting

Support explicit sorting contracts for:

- MapLab layers
- Character internal art
- Weapons
- Foreground objects
- Transient effects

Avoid rebuilding an entire scene graph solely to change a character's animation frame.

---

# 14. Simulation and Presentation Integration

RenderLab must remain simulation-independent.

A consuming game provides:

- Entity identifiers
- Position and orientation
- Current animation state
- Animation entry tick
- Facing
- Visibility
- Appearance and equipment references
- Optional presentation events

The renderer converts that information into visible objects.

## Fixed-tick integration

The reference simulation should advance at 60 Hz.

Rendering occurs at the browser's available display cadence.

```text
Fixed simulation update
          |
          v
Authoritative state
          |
          v
Presentation snapshot
          |
          v
Visual interpolation
          |
          v
GPU rendering
```

The presentation layer may interpolate:

- Character positions
- Camera positions
- Non-authoritative effects
- Allowed animation transforms

It must not interpolate or modify authoritative collision or combat results.

## Determinism

The same simulation inputs and initial state must produce the same authoritative results regardless of:

- Renderer backend
- GPU
- Display refresh rate
- Graphic quality preset
- Camera position
- Visual effects configuration

RenderLab must not feed presentation state back into simulation authority.

## Reference state provider

For the standalone benchmark, create a small synthetic fixed-tick state provider.

It should demonstrate:

- Actor movement
- Animation changes
- Facing changes
- Scene traversal
- Spawn and despawn
- Visual events

Do not build a complete physics, combat, or AI engine.

---

# 15. Performance Architecture

Rendering performance is a primary architectural requirement.

Focus on reducing work before introducing complex GPU-specific optimizations.

## 15.1 Batching

Use PixiJS's batching systems.

Optimize:

- Shared materials
- Texture reuse
- Atlas page organization
- Compatible sprite submissions
- Static terrain grouping
- Particle rendering

Measure actual draw calls instead of assuming a batch maps to a single draw.

## 15.2 Chunk culling

Render only relevant terrain chunks.

Support:

- Camera-based visibility
- Configurable preload margins
- Chunk activation/deactivation
- Dynamic chunk invalidation
- Resource eviction

## 15.3 Character optimization

Use:

- Shared textures
- Shared animation resources
- Baked transforms
- Reusable character presentation data
- Minimal per-frame allocations
- Efficient actor updates

Benchmark articulated characters against baked sprite frames at different population sizes.

## 15.4 Particles

Implement a reusable particle system for:

- Impacts
- Dust
- Weather
- Water
- Magic
- Movement trails
- Environmental ambience

Use PixiJS particle containers and GPU-friendly techniques.

The baseline should not require compute shaders.

## 15.5 Quality presets

Provide:

- Low
- Medium
- High
- Auto

Quality profiles may adjust:

- DPR
- Particle budgets
- Visual effect complexity
- Offscreen effect resolution
- Optional decorative density
- Texture loading priorities

Do not change gameplay geometry or gameplay behavior with graphics quality.

## 15.6 Adaptive resolution

Support dynamic resolution adjustment based on measured performance.

Requirements:

- Configurable target frame time
- Bounded DPR
- Stable adjustment intervals
- Hysteresis to avoid oscillation
- Correct resize handling
- Recovery after background-tab suspension

Strict pixel mode must preserve its pixel-grid guarantees.

If adaptive DPR conflicts with integer pixel scaling, apply the pixel-art policy rather than silently violating it.

---

# 16. WebGPU Development Track

WebGPU is part of the baseline architecture, not an afterthought.

However, initial production behavior must not depend on WebGPU availability.

## Initial WebGPU deliverables

- Backend initialization
- Capability reporting
- Basic scene rendering
- MapLab terrain parity
- RigLab character parity
- Atlas sampling parity
- Animation parity
- Shader/filter parity
- Device-loss handling
- Automated compatibility tests

## Advanced WebGPU opportunities

Reserve extension points for:

- Compute-based particle simulation
- GPU visibility calculations
- Storage-buffer actor presentation
- GPU-driven instance updates
- Advanced lighting
- Shader-based weather
- Water distortion
- Multipass effects
- Large crowd rendering

Do not implement these merely because WebGPU supports them.

Require a measured advantage or an otherwise unavailable visual capability.

## Shader architecture

Custom effects must be isolated behind renderer-level contracts.

Where WebGL2 and WebGPU need different shader languages, provide compatible variants.

WebGL2 uses GLSL ES.

WebGPU uses WGSL.

A WebGPU-only shader must have an explicit WebGL2 alternative or be classified as an optional effect.

Avoid embedding backend-specific shader assumptions into MapLab or RigLab asset formats.

---

# 17. Browser and Device Compatibility

Target modern desktop and mobile browsers.

Test at minimum:

- Chrome desktop
- Edge desktop
- Firefox desktop
- Safari macOS
- Chrome Android
- Safari iOS/iPadOS

Validate real capabilities rather than assuming availability from browser names.

## Requirements

- WebGL2 production compatibility
- WebGPU support where available
- Responsive viewport resizing
- High-DPI handling
- Portrait/landscape transitions
- Touch-device rendering
- Reduced-motion support
- Background-tab behavior
- Context/device-loss recovery

## Rendering recovery

On WebGL context loss or WebGPU device loss:

1. Detect the failure.
2. Stop issuing invalid rendering commands.
3. Preserve external simulation state.
4. Reinitialize the rendering backend where possible.
5. Restore required GPU resources.
6. Restore the scene from presentation state.
7. Report recovery status.

A failed GPU resource should not corrupt the asset library or authoritative simulation state.

## Worker rendering

Design interfaces that do not unnecessarily prohibit future OffscreenCanvas or worker-based rendering.

Do not move rendering to workers during the baseline unless profiling establishes a measurable benefit and browser compatibility is verified.

---

# 18. Diagnostics and Performance Benchmark

Create a standalone reference application.

The demonstration must exercise real MapLab and RigLab export data.

Use placeholders only where actual fixtures lack artwork or required presentation resources.

Clearly identify placeholder content.

## Required demo capabilities

- Load a MapLab world
- Render terrain and tilemaps
- Move the camera through the world
- Display parallax backgrounds
- Display foreground occlusion
- Load RigLab characters
- Play available RigLab animations
- Switch supported skins and equipment
- Compare articulated and baked presentation
- Demonstrate strict pixel-art rendering
- Spawn configurable particles
- Select WebGL2 or WebGPU
- Change rendering quality
- Show performance diagnostics

The demo must operate without a game server.

## Diagnostic panel

Display:

- Active graphics backend
- Graphics API availability
- Browser and device information
- FPS
- Average frame time
- P95 frame time
- CPU presentation-update time
- Draw calls
- Visible terrain chunks
- Visible characters
- Active particles
- Texture count
- Texture/resource memory estimates
- Asset loading state
- Renderer recovery events

Label estimated values clearly.

Do not present estimated memory values as exact hardware measurements.

## Benchmark scenarios

Create repeatable scenarios:

### Scenario A — Static environment

Measure terrain rendering, layers, atlas usage, and camera movement.

### Scenario B — Animated characters

Measure articulated rigs with increasing character counts.

### Scenario C — Baked characters

Measure the same animation workload using baked sprite frames.

### Scenario D — Particles

Measure increasing particle populations.

### Scenario E — Large world traversal

Measure chunk activation, unloading, memory use, and frame-time spikes.

### Scenario F — Backend comparison

Run equivalent scene states through WebGL2 and WebGPU.

### Scenario G — Mobile performance

Measure representative low-, mid-, and high-capability devices.

## Performance targets

Target:

- Smooth 60 FPS on specified desktop reference hardware
- Configurable 30/60 FPS mobile tiers
- Stable frame pacing
- Predictable resource usage
- No significant loading hitches during ordinary traversal

Targets must be evaluated against documented hardware and browser versions.

Do not claim targets are achieved without recorded benchmark evidence.

---

# 19. Testing and Validation

Use layered tests.

## Contract tests

Verify:

- MapLab manifest and format validation
- RigLab manifest and format validation
- Unsupported version handling
- Unknown feature rejection
- Invalid geometry handling
- Invalid bone references
- Invalid animation references
- Source ID preservation
- Asset integrity

Use actual published conformance fixtures where available.

## Asset tests

Verify:

- Deterministic compilation
- Atlas UV correctness
- Texture dimensions
- Resource identity
- Source hash retention
- Skin and weapon references
- Asset unloading
- Cache invalidation

## Animation tests

Verify:

- Baked transform playback
- Frame accuracy
- Correct loop behavior
- One-shot completion
- Weapon positioning
- Hand/weapon paint order
- Facing-dependent depth
- Strict pixel mode
- Stepped presentation

## Rendering tests

Verify:

- WebGL2 scene rendering
- WebGPU scene rendering
- Backend selection
- Camera behavior
- Terrain ordering
- Transparency
- Filters
- Sprite transforms
- DPI handling
- Resize behavior

## Visual regression

Capture stable screenshots for:

- Map scenes
- Character poses
- Equipment variants
- Facing directions
- Pixel-art output
- Foreground occlusion
- Particle effects

Run backend comparisons with appropriate tolerance for platform-level rasterization differences.

Exact pixel equality should only be required where the rendering contract and test environment support it.

## Performance regression

Track:

- Frame-time distributions
- Draw calls
- Resource counts
- Texture uploads
- Scene load time
- Chunk rebuild time
- Memory growth
- Recovery behavior

Do not make performance tests depend on unstable machine-specific expectations without qualification.

## CI acceptance

The canonical validation command must cover:

- Type checking
- Unit tests
- Contract tests
- Asset compiler tests
- Rendering tests
- Build
- Governance checks
- Security checks

Browser and GPU tests may require dedicated supported environments.

Report unavailable GPU test capabilities explicitly instead of silently marking them successful.

---

# 20. Implementation Plan

Implement the baseline through small, independently verifiable tasks.

Each task must contain:

- Scope
- Dependencies
- Acceptance criteria
- Automated tests
- Validation requirements
- Documentation impact
- Explicit non-goals

Use `RLDR-*` as the task identifier namespace.

## Phase 1 — Repository and renderer foundation

### RLDR-001 — Repository bootstrap and governance

Establish the standalone RenderLab repository.

Deliver:

- Node/npm toolchain
- TypeScript configuration
- Vite application
- Vitest and Playwright
- Repository policies
- AGENTS.md
- implementation_plan.md
- CI validation
- Canonical `npm run check`

Acceptance:

- Clean install succeeds.
- Type checking succeeds.
- Tests succeed.
- Production build succeeds.
- Governance and required checks are operational.

### RLDR-002 — Renderer-neutral scene contracts

Define:

- Scene model
- Sprite descriptors
- Layer descriptors
- Camera state
- Animation presentation state
- Resource handles
- Lifecycle contracts
- Snapshot integration interface

Acceptance:

- Core interfaces do not import PixiJS, React, or DOM APIs.
- Unit tests cover contracts and lifecycle state.

### RLDR-003 — PixiJS WebGL2 foundation

Initialize PixiJS v8 with an explicitly verified WebGL2 baseline.

Deliver:

- Canvas mounting
- Renderer initialization
- Scene mounting
- Sprite rendering
- Clean teardown

Acceptance:

- Reference scene renders using WebGL2.
- Unsupported WebGL2 configurations report a clear error.

### RLDR-004 — WebGPU backend and capability selection

Deliver:

- WebGPU initialization
- Backend selection
- Capability probing
- Auto fallback
- Backend diagnostics

Acceptance:

- Both backends run where supported.
- Unsupported WebGPU configurations are handled safely.
- Explicit backend requirements are respected.

### RLDR-005 — Camera and viewport

Deliver:

- Orthographic 2D camera behavior
- Pan/zoom
- DPR handling
- World/screen transforms
- Resize
- Pixel-grid options

Acceptance:

- Coordinate and viewport tests pass.
- Pixel alignment is correct under the declared strict-pixel policy.

## Phase 2 — Asset compilation

### RLDR-006 — Asset manifests and integrity

Deliver:

- Bundle readers
- Manifest parsing
- Hash validation
- Resource identity
- Loading lifecycle

Acceptance:

- Valid bundles load.
- Corrupt or incompatible bundles are rejected.

### RLDR-007 — SVG rasterization and atlases

Deliver:

- SVG-to-texture compilation
- Deterministic output policy
- Atlas packing
- UV metadata
- Filtering options

Acceptance:

- Compiled textures reproduce source art within documented rasterization guarantees.
- Atlas coordinates are validated.

## Phase 3 — MapLab integration

### RLDR-008 — MapLab export adapter

Deliver:

- Versioned bundle ingestion
- Contract negotiation
- World scene extraction
- Source ID mapping

Acceptance:

- Supported MapLab fixture exports load successfully.
- Unsupported required features fail explicitly.

### RLDR-009 — Terrain batching and culling

Deliver:

- Sparse chunk rendering
- GPU batching
- Chunk visibility
- Incremental updates
- Resource eviction

Acceptance:

- Reference terrain renders correctly.
- Only relevant chunks are submitted.
- Dirty changes avoid rebuilding unrelated chunks.

### RLDR-010 — MapLab visual layers

Deliver:

- Layer composition
- Parallax
- Foreground occlusion
- Camera relationships
- Visual prefab handling

Acceptance:

- Layer order matches the authored contracts.
- Camera and parallax fixtures pass.

## Phase 4 — RigLab integration

### RLDR-011 — RigLab export adapter

Deliver:

- Rig and animation import
- Baked frame loading
- Weapon transforms
- Reference validation

Acceptance:

- Supported RigLab exports load.
- Baked transforms reproduce the exported data.

### RLDR-012 — Articulated character rendering

Deliver:

- Bone-part textured sprites
- Frame playback
- Facing
- Internal layering
- Shared resources

Acceptance:

- RigLab reference animations render correctly.
- Part positions match the selected baked frames.

### RLDR-013 — Skins, equipment, and weapons

Deliver:

- Skin binding
- Palette handling
- Equipment composition
- Weapon transforms
- Depth ordering

Acceptance:

- Character appearance changes without modifying animation authority.
- Grip and paint-order tests pass.

### RLDR-014 — Baked sprites and pixel art

Deliver:

- Baked frame atlases
- Strict pixel-art mode
- Stepped playback
- Mode switching

Acceptance:

- Articulated and baked modes derive from the same source animation.
- Pixel-art regression tests pass.

## Phase 5 — Runtime presentation

### RLDR-015 — Fixed-tick presentation bridge

Deliver:

- Reference state provider
- Snapshot interface
- Animation state selection
- Visual interpolation
- Deterministic playback tests

Acceptance:

- Different renderer frame rates produce identical authoritative reference state.
- Rendering does not modify simulation data.

### RLDR-016 — Particles and visual effects

Deliver:

- Shared particle rendering
- Basic effects
- Optional shaders
- Backend-compatible effect behavior

Acceptance:

- Effects work on both supported graphics backends.
- Resource budgets are enforced.

### RLDR-017 — Quality and resource lifecycle

Deliver:

- Quality presets
- Adaptive resolution
- Asset unloading
- GPU recovery
- Lifecycle diagnostics

Acceptance:

- Scenes clean up resources.
- Rendering recovery preserves external simulation state.
- Graphics quality does not alter gameplay state.

## Phase 6 — Integrated reference application

### RLDR-018 — MapLab + RigLab demonstration

Deliver:

- Representative side-scrolling environment
- Terrain
- Parallax
- Camera traversal
- RigLab actors
- Equipment
- Animation playback
- Effects
- Graphics controls

Acceptance:

- Standalone reference application works without a game server.
- No editor runtime dependency is required.

### RLDR-019 — Browser visual regression

Deliver:

- WebGL2 screenshots
- WebGPU screenshots
- Cross-backend comparisons
- Pixel-art snapshots
- Browser compatibility reports

Acceptance:

- Supported environments pass established visual tolerances.
- Unsupported environments are reported accurately.

### RLDR-020 — Performance benchmark suite

Deliver:

- Repeatable load scenarios
- Frame-time metrics
- Draw-call tracking
- Asset metrics
- Memory analysis
- Desktop/mobile comparison reports

Acceptance:

- Performance results are reproducible.
- Benchmark identities include build, browser, hardware, and renderer.

## Phase 7 — Baseline completion

### RLDR-021 — Documentation and integration acceptance

Deliver:

- Final architecture documentation
- Asset compilation documentation
- MapLab adapter documentation
- RigLab adapter documentation
- Rendering API documentation
- GPU backend compatibility matrix
- Performance report
- External game integration example

Acceptance:

- A separate consumer can initialize RenderLab and display validated MapLab/RigLab content without importing editor code.
- Canonical validation passes.
- All baseline acceptance requirements are documented and verified.

---

# 21. Delivery and Change Management

Adopt the existing Wizard-Gang governed delivery conventions where applicable.

## Required workflow

```text
Read current main
       |
       v
Read AGENTS.md
       |
       v
Read implementation_plan.md
       |
       v
Select first open task
       |
       v
Create branch
       |
       v
Implement
       |
       v
Validate locally
       |
       v
Open PR
       |
       v
Verify exact-head CI
       |
       v
Squash merge
       |
       v
Verify resulting main
       |
       v
Delete delivered branch
       |
       v
Update active task queue
```

## Rules

- Work from live repository authority.
- Deliver the first available task in dependency order.
- Prefer small, independently reviewable changes.
- Preserve later task IDs.
- Do not silently expand task scope.
- Keep completed tasks out of the active implementation queue.
- Preserve necessary historical change records.
- Require passing validation before merge.
- Do not bypass protected branch or provider controls.
- Do not claim tests or approvals that did not occur.
- No production release or deployment without a separate governed task.

If blocked, record the exact blocker and stop rather than inventing a workaround.

Every completed task must leave the repository in a verifiable state.

---

# 22. Explicit Non-Goals

RenderLab must not expand into an unrelated engine or editor.

Out of scope:

- Game-specific combat systems
- Authoritative physics
- AI decision making
- Navigation solver ownership
- Multiplayer networking
- Matchmaking
- Game progression
- Character creation tools
- Map authoring tools
- Animation keyframe editors
- Save-game authority
- Backend game servers
- Custom full replacement for PixiJS
- Mandatory WebGPU compute pipelines
- Full 3D rendering
- A new competing asset-authoring format

RenderLab may provide visual debugging for external systems without taking ownership of them.

---

# 23. Acceptance Criteria

The baseline is complete only when all of the following are demonstrated.

## Architecture

- [ ] Standalone TypeScript rendering project exists.
- [ ] PixiJS v8 is the selected rendering library.
- [ ] Core presentation interfaces are renderer-neutral.
- [ ] WebGL2 and WebGPU are selectable.
- [ ] Backend initialization and fallback behave correctly.
- [ ] Renderer does not own authoritative simulation state.

## MapLab

- [ ] Versioned export bundles are validated.
- [ ] Terrain chunks render correctly.
- [ ] Tile transformations are preserved.
- [ ] Visual layer ordering is correct.
- [ ] Parallax works.
- [ ] Foreground occlusion works.
- [ ] Camera behavior respects declared bounds.
- [ ] Source IDs remain traceable.
- [ ] Collision remains independent of rendering.

## RigLab

- [ ] Versioned export bundles are validated.
- [ ] Baked transforms are supported.
- [ ] Articulated characters render correctly.
- [ ] Animation timing is preserved.
- [ ] Facing and depth order are correct.
- [ ] Weapons and equipment render correctly.
- [ ] Skins and palettes are supported.
- [ ] Baked sprite-frame mode works.
- [ ] Strict pixel-art mode works.

## Assets

- [ ] Deterministic compilation policy is implemented.
- [ ] Texture atlases are generated and validated.
- [ ] Asset integrity is verified.
- [ ] Runtime asset bundles load correctly.
- [ ] Shared textures are reused.
- [ ] Resources unload correctly.
- [ ] Cache identities are stable.
- [ ] Invalid or unsupported assets fail safely.

## Performance

- [ ] Chunk culling is operational.
- [ ] Sprite batching is operational.
- [ ] Particle budgets are enforced.
- [ ] Quality presets are operational.
- [ ] Adaptive resolution is available.
- [ ] Desktop benchmarks are recorded.
- [ ] Mobile benchmarks are recorded.
- [ ] WebGL2 and WebGPU comparisons are recorded.

## Quality

- [ ] Automated unit tests pass.
- [ ] Contract tests pass.
- [ ] Asset tests pass.
- [ ] Browser rendering tests pass on supported environments.
- [ ] Visual regression tests pass.
- [ ] Resource lifecycle tests pass.
- [ ] Rendering recovery is tested.
- [ ] Documentation is complete.
- [ ] Canonical validation passes.

---

# 24. Definition of Complete

RenderLab is baseline-complete when a standalone browser application can:

1. Load a validated MapLab world.
2. Render its terrain, layers, and parallax using PixiJS v8.
3. Load validated RigLab characters.
4. Reproduce RigLab animations through baked transforms.
5. Display skins, weapons, and equipment correctly.
6. Support articulated character rendering and baked sprite-frame rendering.
7. Preserve strict pixel-art presentation where requested.
8. Render equivalent content through WebGL2 and WebGPU on supported devices.
9. Load, cache, and release GPU resources predictably.
10. Recover safely from graphics-device failures where possible.
11. Run independently of a specific game or multiplayer server.
12. Expose a documented presentation API usable by future games.
13. Pass the canonical functional, contract, rendering, and governance validation suites.
14. Produce documented desktop/mobile performance evidence.

The result must be a reusable platform, not a demonstration that only works with hardcoded sample content.

---

# 25. Long-Term Architecture

The intended first-party ecosystem is:

```text
                 WIZARD-GANG 2D ECOSYSTEM

                     +------------+
                     |   MapLab   |
                     |            |
                     | Map Editor |
                     | Terrain    |
                     | World Data |
                     +-----+------+
                           |
                           v
                     World Export
                           |
                           |
                           v
+------------+       +------------+       +-------------+
|   RigLab   |       | RenderLab  |       | Game Engine |
|            |       |            |       |             |
| Rigs       +------>| PixiJS v8  |<------+ Simulation  |
| Animations |       | WebGL2     |       | Physics     |
| Weapons    |       | WebGPU     |       | Combat      |
| Skins      |       | GPU Assets |       | AI          |
+-----+------+       +-----+------+       +-------------+
      |                    ^
      v                    |
 Character Export          |
      |                    |
      +--------------------+
                           |
                           v
                     Browser GPU
```

The relationship is deliberately asymmetric:

**MapLab authors worlds.**

**RigLab authors characters and animations.**

**RenderLab presents exported worlds and characters.**

**Independent game engines control what happens inside those worlds.**

Future games may adopt RenderLab without changing MapLab or RigLab.

Future graphics technologies may replace the rendering backend without changing authored content or game simulation.

This separation is a permanent architectural objective.

---

# 26. Final Implementation Directive

Establish RenderLab as a standalone, production-oriented TypeScript 2D rendering foundation.

Use PixiJS v8.

Develop WebGL2 as the initial production backend and WebGPU as a fully supported, independently validated backend.

Consume the existing MapLab and RigLab export contracts without duplicating their editor functionality or redefining their asset semantics.

Prioritize:

1. Correct architecture and contract boundaries.
2. Reliable GPU rendering.
3. Accurate MapLab and RigLab presentation.
4. Efficient asset compilation and caching.
5. Strict pixel-art quality.
6. Measured rendering performance.
7. Cross-browser compatibility.
8. Deterministic simulation independence.
9. Automated testing and regression prevention.
10. Governed, incremental delivery.

Complete the baseline in the defined implementation order.

Do not introduce unrelated game features, new authoring systems, or speculative optimizations.

**Final objective:**

Deliver a reusable, GPU-native 2D rendering platform that combines MapLab's world-building capabilities, RigLab's character and animation systems, and PixiJS v8's WebGL2/WebGPU rendering into one portable, efficient, and independently maintainable browser rendering architecture.
