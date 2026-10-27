// Terrain batching benchmark (RLDR-009, specification §8.2, §15.1): per-chunk geometry against render-texture caching.
// It measures the CPU side in Node (geometry build time and bytes, residency accounting while panning) and derives the
// render-texture side from its pixel sizes, since a render texture's cost is its pixels. GPU timings are out of reach
// here; the browser's diagnostics count the real draw calls. Prints JSON; docs/PERFORMANCE.md records the results.
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
try {
  const terrain = await server.ssrLoadModule('/src/render/terrain/index.ts');
  const { buildChunkGeometry, geometryBytes, ChunkResidency, chunkWanted } = terrain;

  // A deterministic full chunk: every cell filled, tiles spread over two atlas pages, every transform in use.
  let seed = 0x9e3779b9;
  const next = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
  const regions = new Map(Array.from({ length: 64 }, (_, index) => {
    const id = `tile.${index}`;
    const column = index % 32;
    return [id, { id, page: index < 32 ? 0 : 1, u0: column / 32, v0: 0, u1: (column + 1) / 32, v1: 1 }];
  }));
  const fullChunk = (column, row) => ({
    kind: 'tile-chunk', id: `chunk.${column}.${row}`, layerId: 'terrain', mobility: 'static', visible: true, sortKey: 0, source: null,
    tileset: 'tileset.bench', grid: { origin: { x: 0, y: 0 }, cellSize: { x: 16, y: 16 } }, column, row,
    cells: Array.from({ length: 1024 }, () => ({
      tile: `tile.${Math.floor(next() * 64)}`, quarterTurns: Math.floor(next() * 4), mirrorX: next() < 0.5, mirrorY: next() < 0.5,
    })),
  });

  const chunk = fullChunk(0, 0);
  for (let warm = 0; warm < 50; warm += 1) buildChunkGeometry(chunk, regions);
  const samples = [];
  for (let run = 0; run < 400; run += 1) {
    const start = performance.now();
    buildChunkGeometry(chunk, regions);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const pages = buildChunkGeometry(chunk, regions);
  const geometry = {
    tiles: 1024, pages: pages.length,
    buildMs: { median: +samples[200].toFixed(3), p95: +samples[380].toFixed(3) },
    bytes: geometryBytes(pages),
  };

  // Render-texture caching keeps each chunk's pixels at device resolution: (32 cells × cell size × device scale)² × 4.
  const renderTexture = [16, 32].flatMap((cell) => [1, 2].map((deviceScale) => ({
    cell, deviceScale, bytes: (32 * cell * deviceScale) ** 2 * 4,
  })));

  // Pan a 1920×1080 view at zoom 1 across a 64×8-chunk world of 16-unit cells, one screen width per step.
  const world = [];
  for (let column = 0; column < 64; column += 1) for (let row = 0; row < 8; row += 1) world.push(fullChunk(column, row));
  const byId = new Map(world.map((entry) => [entry.id, entry]));
  let builtBytes = 0;
  const residency = new ChunkResidency({
    build: (id) => {
      const bytes = geometryBytes(buildChunkGeometry(byId.get(id), regions));
      builtBytes += bytes;
      return bytes;
    },
    release: (bytes) => { builtBytes -= bytes; },
  }, 64);
  for (const entry of world) residency.track(entry.id);
  let maxActive = 0;
  let maxBytes = 0;
  const panStart = performance.now();
  for (let x = 0; x <= 64 * 512 - 1920; x += 1920) {
    const rect = { x, y: 1024, width: 1920, height: 1080 };
    residency.show(world.filter((entry) => chunkWanted(entry, rect, 1)).map((entry) => entry.id));
    maxActive = Math.max(maxActive, residency.stats().active);
    maxBytes = Math.max(maxBytes, builtBytes);
  }
  const panning = { ...residency.stats(), maxActive, maxGeometryBytes: maxBytes, totalMs: +(performance.now() - panStart).toFixed(1) };

  console.log(JSON.stringify({ geometry, renderTexture, panning }, null, 2));
} finally {
  await server.close();
}
