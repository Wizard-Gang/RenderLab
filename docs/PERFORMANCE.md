# Performance

Performance decisions and the evidence behind them (specification §15, §18). A target counts as met only with
recorded evidence: the hardware, browser or runtime, the command and its numbers.

## Terrain batching (RLDR-009)

**Decision: per-chunk geometry batching.** Each sparse 32×32 chunk becomes one indexed quad mesh per atlas page it
uses (`src/render/terrain/`). Render-texture caching is not implemented. Revisit it only for a workload that shows
many chunks at once at low device scale, such as a far zoomed-out overview, and measure it there first.

### What each option costs

| | Geometry batching (chosen) | Render-texture caching |
| --- | --- | --- |
| Memory per full chunk | 88 KiB of vertex and index data | (32 × cell × device scale)² × 4 bytes: 1 MiB at 16-unit cells and scale 1, 4 MiB at scale 2, 16 MiB for 32-unit cells at scale 2 |
| Rebuilding one edited chunk | 0.23 ms median CPU, then one buffer upload | Re-render the chunk's tiles into its texture: a GPU pass and a render-target bind |
| Draw calls | One per active chunk per atlas page used | One per batch of up to `maxBatchableTextures` (usually 16) chunks |
| Zoom and device scale | Exact at any zoom; texels stay crisp under strict-pixel | Resolution fixed when cached; zooming in blurs or forces a re-render |

The deciding factor is memory under the chunk budget (§12.4). At the default budget of 64 resident chunks, geometry
holds at most about 5.5 MiB. Render textures for the same 64 chunks would hold 64 MiB at 16-unit cells and DPR 1, and
256 MiB at DPR 2, more than many mobile devices can spare. Geometry also keeps tile transforms exact at every zoom
and rebuilds an edited chunk in well under a millisecond. Render textures win only on draw calls. Measured draw calls
stay modest: at 1080p and zoom 1, at most 35 active chunks with the one-chunk margin, so at most 70 draws with two
atlas pages. A tileset on one atlas page halves that.

### Evidence

`node scripts/bench-terrain.mjs` (`npm run bench:terrain`), run 2026-10-27 on an Apple M4 with 24 GiB, macOS 26.5.1
and Node 26.10.0:

- Building a full chunk (1,024 tiles across two pages, every turn and mirror in use) takes a median of 0.232 ms and
  a 95th percentile of 0.275 ms over 400 runs. Its geometry is 90,112 bytes.
- Panning a 1920×1080 view at zoom 1 across a 64×8-chunk world of 16-unit cells, one screen width per step, with the
  one-chunk preload margin and a 64-chunk budget: at most 35 chunks active, 320 builds, 256 evictions, never more than
  64 chunks built, and at most 5,767,168 bytes of geometry. The whole traversal's culling and building took 100.5 ms.
- Render-texture memory comes from its pixel size, as the table shows, not from a run.

PixiJS batches meshes of at most 100 vertices; a chunk mesh has 4 vertices per tile, so any chunk with more than 25
tiles on a page draws as its own call. The renderer counts the draw calls it actually issues and reports them per frame
as `gpu.drawCalls` (basis `counted`), beside `terrain` (chunks, active, built, budget, builds, rebuilds, evictions and
meshes). WebGPU render bundles are not counted; RenderLab does not use them.

### Not yet measured

GPU frame time for either option, and any mobile device (§18 Scenario G). The browser suite checks the terrain scene's
pixels and its counted draw calls, but CI's software renderers are not timing evidence.
