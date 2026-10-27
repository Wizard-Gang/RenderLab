import { describe, expect, it } from "vitest";
import { CHUNK_CELLS, computeView, type TileCell } from "../../src/core";
import {
  buildChunkGeometry, ChunkResidency, chunkWanted, layerViewRect, placeCorner, tilesetFromAtlas, tilesetProblems, type TileRegion,
} from "../../src/render/terrain";
import { buildAtlas } from "../../src/assets/atlases/atlas";
import { chunk, layer } from "../core/fixtures";

// MapLab's editor convention, copied from Wizard-Gang/MapLab src/render/terrain.ts `cellPoints` at f999334: mirror
// inside the cell, then turn clockwise on screen about its centre. RenderLab must place every corner the same way.
function mapLabCellPoints(points: readonly [number, number][], cell: Pick<TileCell, "quarterTurns" | "mirrorX" | "mirrorY">): [number, number][] {
  return points.map(([u0, v0]) => {
    let u = cell.mirrorX ? 1 - u0 : u0, v = cell.mirrorY ? 1 - v0 : v0;
    for (let i = 0; i < cell.quarterTurns; i++) [u, v] = [1 - v, u];
    return [u, v];
  });
}

const CASES = Array.from({ length: 16 }, (_, index): TileCell => ({
  tile: "grass", quarterTurns: (index % 4) as TileCell["quarterTurns"], mirrorX: (index & 4) !== 0, mirrorY: (index & 8) !== 0,
}));
const region = (id: string, page: number, u0 = 0, u1 = 1): TileRegion => ({ id, page, u0, v0: 0, u1, v1: 1 });
const REGIONS = new Map([region("grass", 0, 0, 0.5), region("dirt", 0, 0.5, 1), region("rock", 1)].map((entry) => [entry.id, entry]));
const cellsWith = (entries: Record<number, TileCell>) => Array.from({ length: CHUNK_CELLS }, (_, index) => entries[index] ?? null);

describe("terrain geometry", () => {
  it("places tile corners exactly as MapLab does for all sixteen turn and mirror cases", () => {
    const corners: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0.25, 0.75]];
    for (const cell of CASES) expect(corners.map(([u, v]) => placeCorner(u, v, cell))).toEqual(mapLabCellPoints(corners, cell));
  });

  it("lays each tile into its cell, turned and mirrored, with its own region's UVs", () => {
    const turned: TileCell = { tile: "dirt", quarterTurns: 1, mirrorX: true, mirrorY: false };
    const [page] = buildChunkGeometry(chunk(0, 0, { cells: cellsWith({ 33: turned }) }), REGIONS);
    // Cell 33 is column 1, row 1 of 16-unit cells. Art corner (0,0) mirrors to (1,0), then turns to (1,1).
    expect(page.tiles).toBe(1);
    expect([...page.positions]).toEqual([32, 32, 32, 16, 16, 16, 16, 32]);
    expect([...page.uvs]).toEqual([0.5, 0, 1, 0, 1, 1, 0.5, 1]);
    expect([...page.indices]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("splits a chunk by atlas page, keeps variants on their own regions, and refuses tiles the tileset lacks", () => {
    const pages = buildChunkGeometry(chunk(2, 0, { cells: cellsWith({ 0: CASES[0], 1: { ...CASES[0], tile: "dirt" }, 2: { ...CASES[0], tile: "rock" } }) }), REGIONS);
    expect(pages.map((page) => [page.page, page.tiles])).toEqual([[0, 2], [1, 1]]);
    expect([...pages[0].uvs.slice(8, 10)]).toEqual([0.5, 0]);
    expect(() => buildChunkGeometry(chunk(0, 0, { cells: cellsWith({ 7: { ...CASES[0], tile: "lava" } }) }), REGIONS)).toThrow(/cells\[7\] uses tile lava/);
  });

  it("reads a compiled atlas whose region IDs are tile IDs", () => {
    const raster = (width: number) => ({ width, height: 2, data: new Uint8Array(width * 8).fill(255) });
    const atlas = buildAtlas([{ id: "dirt", raster: raster(2) }, { id: "grass", raster: raster(4) }], { maxPageSize: 16, padding: 0, extrude: 0, filter: "nearest" });
    const tileset = tilesetFromAtlas(atlas);
    expect(tilesetProblems(tileset)).toEqual([]);
    expect(tileset.regions.map((entry) => entry.id)).toEqual(["dirt", "grass"]);
    expect(tileset.pages[0]).toMatchObject({ filtering: "nearest", width: atlas.pages[0].width });
    expect(tilesetProblems({ ...tileset, regions: [...tileset.regions, { ...tileset.regions[0], page: 3 }] })).toEqual([
      "regions[2]: tile dirt appears more than once", "regions[2]: page 3 does not exist",
    ]);
  });
});

describe("terrain culling", () => {
  const viewport = { width: 480, height: 270, dpr: 1 };
  // 16-unit cells make each chunk 512 world units square.
  it("wants only chunks inside the view grown by the preload margin", () => {
    const view = computeView({ x: 240, y: 135, zoom: 1, bounds: null }, viewport);
    const rect = layerViewRect(view, [layer("world.terrain", 0)]);
    expect(rect).toEqual({ x: 0, y: 0, width: 480, height: 270 });
    const wanted = (margin: number) => [[0, 0], [1, 0], [-1, 0], [2, 0], [0, 1], [0, 2], [-2, -2]]
      .filter(([column, row]) => chunkWanted(chunk(column, row), rect!, margin)).map(String);
    expect(wanted(0)).toEqual(["0,0"]);
    expect(wanted(1)).toEqual(["0,0", "1,0", "-1,0", "0,1"]);
    expect(wanted(2)).toEqual(["0,0", "1,0", "-1,0", "2,0", "0,1", "0,2", "-2,-2"]);
  });

  it("sees through zoom, parallax and hidden layers", () => {
    const view = computeView({ x: 1000, y: 0, zoom: 2, bounds: null }, viewport);
    expect(layerViewRect(view, [layer("world.terrain", 0)])).toEqual({ x: 880, y: -67.5, width: 240, height: 135 });
    const far = layer("far", 0, null, { parallax: { x: 0.5, y: 1 } });
    expect(layerViewRect(view, [far])?.x).toBe(380);
    expect(layerViewRect(view, [far, layer("far.detail", 0, "far", { parallax: { x: 0.5, y: 1 } })])?.x).toBe(380);
    expect(layerViewRect(view, [layer("hidden", 0, null, { visible: false }), layer("child", 0, "hidden")])).toBeNull();
  });
});

describe("chunk residency", () => {
  function tracked(ids: string[], budget: number) {
    const log: string[] = [];
    let serial = 0;
    const residency = new ChunkResidency<string, string>({
      build: (id) => { serial += 1; log.push(`build ${id}`); return `${id}#${serial}`; },
      release: (built) => log.push(`release ${built}`),
    }, budget);
    for (const id of ids) residency.track(id);
    return { residency, log };
  }

  it("activates and deactivates exactly the wanted chunks, reusing idle geometry", () => {
    const { residency, log } = tracked(["a", "b", "c"], 8);
    const first = residency.show(["a", "b", "unknown"]);
    expect(first.activated.map(([id]) => id)).toEqual(["a", "b"]);
    const second = residency.show(["b", "c"]);
    expect([second.activated.map(([id]) => id), second.deactivated.map(([id]) => id)]).toEqual([["c"], ["a"]]);
    residency.show(["a"]);
    expect(log).toEqual(["build a", "build b", "build c"]);
    expect(residency.stats()).toMatchObject({ chunks: 3, active: 1, resident: 3, builds: 3, activations: 4, deactivations: 3, evictions: 0 });
  });

  it("rebuilds only the edited chunk, and drops an idle chunk's stale geometry until it is needed", () => {
    const { residency, log } = tracked(["a", "b", "c"], 8);
    residency.show(["a", "b"]);
    residency.show(["a"]);
    log.length = 0;
    expect(residency.invalidate("a")).toBe("a#3");
    expect(residency.invalidate("b")).toBeUndefined();
    expect(residency.invalidate("c")).toBeUndefined();
    expect(log).toEqual(["release a#1", "build a", "release b#2"]);
    expect(residency.stats()).toMatchObject({ active: 1, resident: 1, builds: 2, rebuilds: 1 });
    residency.show(["a", "b"]);
    expect(residency.built("b")).toBe("b#4");
  });

  it("evicts the least recently used idle chunks beyond the budget but never an active one", () => {
    const { residency, log } = tracked(["a", "b", "c", "d", "e"], 2);
    residency.show(["a"]);
    residency.show(["b"]);
    residency.show(["c"]);
    expect(log.filter((entry) => entry.startsWith("release"))).toEqual(["release a#1"]);
    residency.show(["c", "d", "e"]);
    expect(residency.stats()).toMatchObject({ active: 3, resident: 3, budget: 2, evictions: 2 });
    residency.forget("e");
    residency.clear();
    expect(log.slice(-3)).toEqual(["release e#5", "release c#3", "release d#4"]);
    expect(residency.stats()).toMatchObject({ chunks: 0, active: 0, resident: 0 });
  });

  it("counts each chunk once per activation, whatever order IDs arrive in", () => {
    const { residency } = tracked(["x", "y"], 4);
    residency.show(["y", "x", "y"]);
    expect(residency.activeIds().sort()).toEqual(["x", "y"]);
    expect(residency.stats()).toMatchObject({ builds: 2, activations: 2 });
  });
});
