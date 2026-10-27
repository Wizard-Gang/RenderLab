import { BufferImageSource, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { computeView, objectId, SceneStore, type SceneDefinition } from "../../src/core";
import { PixiSceneGraph } from "../../src/render/pixi/scene-graph";
import type { LoadedTileset } from "../../src/render/terrain";
import { cell, chunk, layer, resource } from "../core/fixtures";

const page = new Texture({ source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1, format: "rgba8unorm" }) });
const tileset: LoadedTileset = { textures: [page], regions: new Map([["grass", { id: "grass", page: 0, u0: 0, v0: 0, u1: 1, v1: 1 }]]) };
const viewport = { width: 480, height: 270, dpr: 1 };

function scene(): SceneDefinition {
  return {
    id: "scene.terrain" as never,
    resources: [resource("tileset.forest", "tileset")],
    layers: [layer("world.terrain", 0)],
    objects: [chunk(0, 0), chunk(1, 0), chunk(5, 0), chunk(0, 3)],
    camera: { x: 240, y: 135, zoom: 1, bounds: null },
  };
}

describe("PixiSceneGraph terrain", () => {
  it("submits only chunks inside the view plus its margin, and rebuilds only an edited chunk", () => {
    const store = new SceneStore(scene());
    const graph = new PixiSceneGraph(store, () => page, () => tileset, { marginChunks: 1, chunkBudget: 3 });
    expect(graph.terrainStats()).toMatchObject({ chunks: 4, active: 0, builds: 0 });
    graph.applyView(computeView(store.camera, viewport));
    expect(graph.activeChunks()).toEqual(["chunk.0.0", "chunk.1.0"]);
    expect(graph.chunkHolder(objectId("chunk.0.0"))?.children[0]?.children).toHaveLength(1);
    expect(graph.chunkHolder(objectId("chunk.5.0"))?.children).toHaveLength(0);
    expect(graph.terrainStats()).toMatchObject({ active: 2, builds: 2, meshes: 2 });

    graph.apply(store.apply([{ op: "set-cells", id: objectId("chunk.1.0"), cells: [{ index: 5, cell: cell("grass", 2) }] }]));
    graph.apply(store.apply([{ op: "update", id: objectId("chunk.0.0"), patch: { sortKey: 3 } }]));
    expect(graph.terrainStats()).toMatchObject({ builds: 2, rebuilds: 1 });

    graph.apply(store.apply([{ op: "set-camera", camera: { x: 240 + 5 * 512, y: 135, zoom: 1, bounds: null } }]));
    graph.applyView(computeView(store.camera, viewport));
    expect(graph.activeChunks()).toEqual(["chunk.5.0"]);
    expect(graph.terrainStats()).toMatchObject({ active: 1, resident: 3, evictions: 0 });
    graph.apply(store.apply([{ op: "remove", id: objectId("chunk.0.3") }]));
    expect(graph.terrainStats()).toMatchObject({ chunks: 3 });
    graph.destroy();
  });
});
