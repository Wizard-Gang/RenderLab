import { describe, expect, it } from "vitest";
import {
  canonicalJson, ContractError, objectId, resourceId, SceneStore, type SceneChange, type SceneDelta,
} from "../../src/core";
import { cell, character, chunk, definition, layer, prng, resource, sprite } from "./fixtures";

const ids = (values: readonly string[]) => [...values];

describe("SceneStore", () => {
  it("builds a frozen, ordered snapshot from a definition", () => {
    const store = new SceneStore(definition());
    const snapshot = store.snapshot();
    expect(snapshot.revision).toBe(0);
    expect(snapshot.objects.map((object) => object.id)).toEqual(["chunk.0.0", "crate.1", "hero"]);
    expect(snapshot.layers.map((entry) => entry.id)).toEqual(["background", "world", "world.terrain", "world.props", "world.actors", "hud"]);
    expect(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.objects) && Object.isFrozen(snapshot.objects[0])).toBe(true);
    expect(() => { (snapshot.objects[1] as { visible: boolean }).visible = false; }).toThrow(TypeError);
    expect(store.referenceCount(resourceId("tex.crate"))).toBe(1);
  });

  it("reports exactly what each delta changed", () => {
    const store = new SceneStore(definition());
    const dirty = store.apply([
      { op: "add", object: sprite("crate.2", { texture: resourceId("tex.barrel") }) },
      { op: "update", id: objectId("hero"), patch: { transform: { ...character("hero").transform, x: 4 } } },
      { op: "remove", id: objectId("crate.1") },
      { op: "set-camera", camera: { x: 4, y: 0, zoom: 2, bounds: null } },
    ]);
    expect(dirty.revision).toBe(1);
    expect(dirty.objects).toEqual({ added: ["crate.2"], updated: ["hero"], removed: ["crate.1"] });
    expect(dirty.chunks).toEqual([]);
    expect(dirty.layers).toEqual([]);
    expect(dirty.camera).toBe(true);
    expect(store.object(objectId("hero"))?.kind === "character" && store.object(objectId("hero"))).toMatchObject({ transform: { x: 4 } });
  });

  it("dirties only the chunk whose cells change", () => {
    const store = new SceneStore({ ...definition(), objects: [chunk(0, 0), chunk(1, 0), chunk(0, 1)] });
    const dirty = store.apply([{ op: "set-cells", id: objectId("chunk.1.0"), cells: [{ index: 33, cell: cell("stone", 1) }, { index: 0, cell: null }] }]);
    expect(dirty.chunks).toEqual(["chunk.1.0"]);
    expect(dirty.objects).toEqual({ added: [], updated: ["chunk.1.0"], removed: [] });
    const edited = store.object(objectId("chunk.1.0"));
    expect(edited?.kind === "tile-chunk" && [edited.cells[0], edited.cells[33]]).toEqual([null, cell("stone", 1)]);
    const untouched = store.object(objectId("chunk.0.1"));
    expect(untouched?.kind === "tile-chunk" && untouched.cells[0]).toEqual(cell("grass"));
  });

  it("applies a delta atomically: one bad change leaves the store untouched", () => {
    const store = new SceneStore(definition());
    const before = canonicalJson(store.snapshot());
    const delta: SceneChange[] = [
      { op: "remove", id: objectId("crate.1") },
      { op: "update", id: objectId("hero"), patch: { sortKey: Number.NaN } },
      { op: "remove", id: objectId("ghost") },
    ];
    let error: unknown;
    try { store.apply(delta); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ContractError);
    expect((error as ContractError).failures).toEqual([
      "delta[1].patch.sortKey: must be a finite number",
      "delta[2].id: object ghost does not exist",
    ]);
    expect(canonicalJson(store.snapshot())).toBe(before);
    expect(store.revision).toBe(0);
  });

  it("lists a kind change under one ID as removed and added, never updated", () => {
    const store = new SceneStore(definition());
    const dirty = store.apply([
      { op: "remove", id: objectId("crate.1") },
      { op: "add", object: { ...character("crate.1"), layerId: character("x").layerId } },
    ]);
    expect(dirty.objects).toEqual({ added: ["crate.1"], updated: [], removed: ["crate.1"] });
  });

  it("keeps two stores and their callers' inputs isolated", () => {
    const input = definition();
    const first = new SceneStore(input);
    const second = new SceneStore(input);
    (input.objects[1] as unknown as { cells: unknown[] }).cells[0] = cell("lava");
    (input.camera as { zoom: number }).zoom = 9;
    first.apply([{ op: "remove", id: objectId("crate.1") }]);
    expect(second.object(objectId("crate.1"))).toBeDefined();
    const terrain = second.object(objectId("chunk.0.0"));
    expect(terrain?.kind === "tile-chunk" && terrain.cells[0]).toEqual(cell("grass"));
    expect(second.camera.zoom).toBe(2);
  });

  it("refuses to remove a resource or layer still in use, and chunks that collide", () => {
    const store = new SceneStore(definition());
    expect(() => store.apply([{ op: "remove-resource", id: resourceId("tex.crate") }])).toThrow(/resource tex\.crate: is still referenced by 1 object/);
    expect(() => store.apply([{ op: "remove-layer", id: layer("world.actors", 0).id }])).toThrow(/layer world\.actors: still holds 1 object/);
    expect(() => store.apply([{ op: "add", object: { ...chunk(0, 0), id: objectId("chunk.copy") } }])).toThrow(/chunk \(0, 0\) on layer world\.terrain is already held by chunk\.0\.0/);
    const dirty = store.apply([{ op: "remove", id: objectId("crate.1") }, { op: "remove-resource", id: resourceId("tex.crate") }]);
    expect(dirty.resources).toEqual({ added: [], removed: ["tex.crate"] });
    expect(store.referenceCount(resourceId("tex.crate"))).toBe(0);
  });

  it("rejects references to missing or mismatched resources and broken layer trees", () => {
    const store = new SceneStore(definition());
    expect(() => store.apply([{ op: "add", object: sprite("crate.9", { texture: resourceId("rig.chibi") }) }]))
      .toThrow(/object crate\.9\.texture: names rig resource rig\.chibi; expected texture/);
    expect(() => store.apply([{ op: "add-layer", layer: layer("world.extra", 1, "world") }]))
      .toThrow(/layer world\.extra\.order: 1 is already used by sibling layer world\.props|layer world\.props\.order: 1 is already used by sibling layer world\.extra/);
    expect(() => store.apply([{ op: "add-layer", layer: layer("a", 5, "b") }, { op: "add-layer", layer: layer("b", 6, "a") }]))
      .toThrow(/forms a cycle/);
    expect(() => store.apply([{ op: "add-resource", resource: resource("tex.crate", "texture") }])).toThrow(/already exists/);
    expect(() => store.apply([{ op: "add-layer", layer: layer("world.hud", 9, "world", { space: "screen" }) }]))
      .toThrow(/layer world\.hud\.space: must match its parent world's space, world/);
  });

  it("produces identical snapshots for the same seeded delta sequence", () => {
    const run = (seed: number) => {
      const random = prng(seed);
      const store = new SceneStore(definition());
      const history: string[] = [];
      for (let step = 0; step < 150; step += 1) {
        const delta: SceneChange[] = [];
        const id = objectId(`npc.${Math.floor(random() * 6)}`);
        const exists = store.object(id) !== undefined;
        if (!exists) delta.push({ op: "add", object: character(id, { sortKey: Math.floor(random() * 20) }) });
        else if (random() < 0.2) delta.push({ op: "remove", id });
        else delta.push({ op: "update", id, patch: { transform: { ...character(id).transform, x: random() * 500, rotation: random() * 360 } } });
        if (random() < 0.3) delta.push({ op: "set-cells", id: objectId("chunk.0.0"), cells: [{ index: Math.floor(random() * 1024), cell: cell("dirt") }] });
        const dirty = store.apply(delta);
        const named = new Set(delta.flatMap((change) => ("id" in change ? [change.id] : "object" in change ? [change.object.id] : [])));
        expect(new Set([...dirty.objects.added, ...dirty.objects.updated, ...dirty.objects.removed])).toEqual(named);
        history.push(canonicalJson(store.snapshot()));
      }
      return history;
    };
    const first = run(20261018);
    expect(run(20261018)).toEqual(first);
    expect(run(7)).not.toEqual(first);
  });

  it("leaves the revision alone for an empty delta", () => {
    const store = new SceneStore(definition());
    const empty: SceneDelta = [];
    expect(store.apply(empty).revision).toBe(0);
    expect(ids(store.apply([{ op: "set-layer", id: layer("hud", 0).id, patch: { visible: false } }]).layers)).toEqual(["hud"]);
    expect(store.revision).toBe(1);
  });
});
