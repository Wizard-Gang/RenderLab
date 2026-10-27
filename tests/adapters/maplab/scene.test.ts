import { describe, expect, it } from "vitest";
import { readFolder } from "../../../src/assets";
import { CHUNK_CELLS, SceneStore } from "../../../src/core";
import { MapLabError, readMapLabExport, type MapLabWorld } from "../../../src/adapters/maplab";
import { forestFiles } from "../../assets/helpers";
import { materialize, type CaseEdit } from "./mutate";

// RLDR-008: MapLab's locked forest export becomes one valid scene per map, and synthetic edits (applied the way
// MapLab's conformance records are) cover what the forest leaves empty: terrain chunks, bundled sprite art and every
// piece of valid MapLab content RenderLab refuses as `adapter.unsupported` rather than dropping.

const forest = forestFiles();
const FOREST = "maps/forest.map.json";
const decoder = new TextDecoder();
const read = (edits: readonly CaseEdit[] = []): Promise<MapLabWorld> =>
  readMapLabExport(readFolder(edits.length === 0 ? forest : materialize(forest, { id: "synthetic", group: "synthetic", edits, expect: { ok: true } })));

async function refusedWith(edits: readonly CaseEdit[]): Promise<{ code: string; file: string; at: string }> {
  try {
    await read(edits);
  } catch (error) {
    if (error instanceof MapLabError) return { code: error.code, file: error.file, at: error.at };
    throw error;
  }
  throw new Error("expected the export to be refused");
}

/** Every object ID a map defines: each `id` member outside `dependencies` (documents) and `params` (typed refs). */
function definedIds(value: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown, top: boolean) => {
    if (Array.isArray(node)) return node.forEach((item) => walk(item, false));
    if (node === null || typeof node !== "object") return;
    for (const [key, member] of Object.entries(node)) {
      if (key === "id" && !top && typeof member === "string") ids.push(member);
      else if (!(top && key === "dependencies") && key !== "params") walk(member, false);
    }
  };
  walk(value, true);
  return ids;
}

const cells = Array.from({ length: CHUNK_CELLS }, (_, i) =>
  i === 0 ? { tileId: "tile.grass", quarterTurns: 1, mirrorX: true, mirrorY: false }
  : i === CHUNK_CELLS - 1 ? { tileId: "tile.dirt", quarterTurns: 0, mirrorX: false, mirrorY: true } : null);
const chunk = (column: number, row: number, cellList: readonly unknown[] = cells): CaseEdit => ({ file: FOREST, append: "/terrain/0/chunks", value: { column, row, cells: cellList } });
const art: readonly CaseEdit[] = [
  { add: "art/tree.png", text: "owned placeholder bytes", role: "asset" },
  { file: FOREST, append: "/assets", value: { id: "asset.tree-art", path: "art/tree.png", mediaType: "image/png", wuPerAssetUnit: 0.5, size: [32, 64] } },
];

describe("readMapLabExport on MapLab's forest export", () => {
  it("builds a valid scene for every bundled map and a handle for every source ID", async () => {
    const world = await read();
    expect(world.entryMapId).toBe("map.forest");
    expect([...world.maps.keys()]).toEqual(["map.clearing", "map.forest"]);
    expect([...world.documents.keys()].sort()).toEqual([
      "catalog.core", "map.clearing", "map.forest", "movement.flyer", "movement.ground", "movement.player", "tileset.forest",
    ]);
    for (const [id, scene] of world.maps) {
      expect(scene.mapId).toBe(id);
      expect(() => new SceneStore(scene.definition)).not.toThrow();
      const source = JSON.parse(decoder.decode(forest.get(scene.path))) as unknown;
      const ids = definedIds(source);
      expect(ids.length).toBeGreaterThan(0);
      for (const sourceId of ids) expect(scene.handles.has(sourceId), `${id}: ${sourceId}`).toBe(true);
    }
  });

  it("presents layers, visuals and tilesets, and keeps background layout for composition", async () => {
    const scene = (await read()).maps.get("map.forest")!;
    const { layers, objects, resources, camera } = scene.definition;
    expect(layers.map((layer) => [layer.id, layer.role, layer.space])).toEqual([
      ["layer.sky", "background", "screen"], ["layer.far", "background", "world"], ["layer.near", "background", "world"],
      ["layer.tiles", "tile", "world"], ["layer.world", "sprite", "world"], ["layer.actors", "actors", "world"], ["layer.front", "sprite", "world"],
    ]);
    expect(objects.every((object) => object.kind === "shape")).toBe(true);
    expect(resources).toEqual([{ id: "tileset.forest", kind: "tileset", source: { authority: "maplab", id: "tileset.forest", path: [] } }]);
    expect(camera).toEqual({ x: 640, y: 400, zoom: 1, bounds: { minX: 0, minY: 0, maxX: 1280, maxY: 800 } });
    expect([...scene.backgrounds.keys()]).toEqual(["layer.sky", "layer.far", "layer.near"]);
    expect(scene.backgrounds.get("layer.sky")).toEqual({
      space: "camera", origin: { x: 0, y: 0 }, repeat: "none", repeatSize: { x: 0, y: 0 }, scrollPerTick: { x: 0, y: 0 }, phase: { x: 0, y: 0 },
    });
    expect(scene.handles.get("layer.tiles")).toEqual({ collection: "layers", handle: { kind: "layer", id: "layer.tiles" }, expandedFrom: null });
  });

  it("traces prefab-expanded visuals to their placement and prefab", async () => {
    const scene = (await read()).maps.get("map.forest")!;
    const expanded = [...scene.handles].filter(([id]) => id.startsWith("pp.tree1:"));
    expect(expanded.map(([id]) => id).sort()).toEqual(["pp.tree1:canopy", "pp.tree1:trunk"]);
    for (const [id, handle] of expanded) {
      expect(handle).toEqual({ collection: "visuals", handle: { kind: "object", id }, expandedFrom: { placementId: "pp.tree1", prefabId: "prefab.tree" } });
      expect(scene.definition.objects.find((object) => object.id === id)?.source).toEqual({ authority: "maplab:map.forest", id, path: ["pp.tree1"] });
    }
  });
});

describe("readMapLabExport on synthetic content", () => {
  it("turns a non-empty terrain chunk into a tile-chunk object", async () => {
    const scene = (await read([chunk(1, -1)])).maps.get("map.forest")!;
    expect(() => new SceneStore(scene.definition)).not.toThrow();
    const chunks = scene.definition.objects.filter((object) => object.kind === "tile-chunk");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      id: "layer.tiles:tileset.forest:chunk:1,-1", layerId: "layer.tiles", mobility: "static", tileset: "tileset.forest",
      grid: { origin: { x: 0, y: 0 }, cellSize: { x: 32, y: 32 } }, column: 1, row: -1,
      source: { authority: "maplab:map.forest", id: "layer.tiles", path: [] },
    });
    const [only] = chunks;
    const chunkCells = only?.kind === "tile-chunk" ? only.cells : [];
    expect(chunkCells).toHaveLength(CHUNK_CELLS);
    expect(chunkCells[0]).toEqual({ tile: "tile.grass", quarterTurns: 1, mirrorX: true, mirrorY: false });
    expect(chunkCells[CHUNK_CELLS - 1]).toEqual({ tile: "tile.dirt", quarterTurns: 0, mirrorX: false, mirrorY: true });
    expect(chunkCells.filter((cell) => cell !== null)).toHaveLength(2);
  });

  it("refuses a chunk cell naming no tile of the tileset, and a chunk placed twice", async () => {
    const water = cells.map((cell, i) => (i === 5 ? { tileId: "tile.water", quarterTurns: 0, mirrorX: false, mirrorY: false } : cell));
    expect(await refusedWith([chunk(0, 0, water)])).toEqual({ code: "reference.dangling", file: FOREST, at: "$.terrain[0].chunks[0].cells[5].tileId" });
    expect(await refusedWith([chunk(0, 0), chunk(0, 0)])).toEqual({ code: "object.duplicate", file: FOREST, at: "$.terrain[0].chunks[1]" });
  });

  it("presents bundled image art as a sprite anchored at its pivot and scaled to world units", async () => {
    const scene = (await read([...art, { file: FOREST, set: "/visuals/0/source", value: { kind: "asset", assetId: "asset.tree-art", pivot: [16, 64] } }])).maps.get("map.forest")!;
    expect(() => new SceneStore(scene.definition)).not.toThrow();
    expect(scene.definition.objects.find((object) => object.id === "pp.tree1:canopy")).toMatchObject({
      kind: "sprite", texture: "asset.tree-art", anchor: { x: 0.5, y: 1 },
      transform: { x: 160, y: 576, rotation: 0, scaleX: 0.5, scaleY: 0.5, mirrorX: false, mirrorY: false },
    });
    expect(scene.definition.resources).toContainEqual({ id: "asset.tree-art", kind: "texture", source: { authority: "maplab:map.forest", id: "asset.tree-art", path: [] } });
    expect(scene.handles.get("asset.tree-art")?.handle).toEqual({ kind: "resource", id: "asset.tree-art" });
  });

  it("refuses, never drops, valid MapLab content RenderLab cannot present yet", async () => {
    const unsupported = (file: string, at: string) => ({ code: "adapter.unsupported", file, at });
    const frames = { kind: "frames", assetIds: ["asset.tree-art"], pivot: [16, 64], frameTicks: [6], loop: true };
    expect(await refusedWith([...art, { file: FOREST, set: "/visuals/0/source", value: frames }])).toEqual(unsupported(FOREST, "$.visuals[0].source"));
    expect(await refusedWith([{ file: FOREST, set: "/visuals/1/parentId", value: "pp.tree1:canopy" }])).toEqual(unsupported(FOREST, "$.visuals[1].parentId"));
    const presentation = {
      id: "presentation.hero", kind: "riglab", bundleDependencyId: "riglab.hero", expectedExportVersion: 1, rigGroundAnchor: [0, 0],
      worldUnitsPerRigUnit: { num: 1, den: 1 }, nativeFacing: "right", rootMotion: "visualOnly", groundContact: "supportLine", artSlots: [], actions: [],
    };
    expect(await refusedWith([{ file: FOREST, append: "/presentations", value: presentation }])).toEqual(unsupported(FOREST, "$.presentations"));
    expect(await refusedWith([{ add: "riglab/hero/manifest.json", text: "{}", role: "foreign" }])).toEqual(unsupported("manifest.json", "$.files[6]"));
    const riglab = { id: "riglab.hero", kind: "riglab", path: "riglab/hero/manifest.json", required: false };
    expect(await refusedWith([{ file: FOREST, append: "/dependencies", value: riglab }])).toEqual(unsupported(FOREST, "$.dependencies[7]"));
  });
});
