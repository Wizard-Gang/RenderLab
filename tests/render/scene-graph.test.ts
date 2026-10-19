import { BufferImageSource, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { layerId, objectId, resourceId, SceneStore, type ResourceId, type SceneDefinition } from "../../src/core";
import { UnsupportedSceneError } from "../../src/render";
import { PixiSceneGraph } from "../../src/render/pixi/scene-graph";
import { character, layer, resource, sprite } from "../core/fixtures";

const textures = new Map<string, Texture>(["tex.a", "tex.b"].map((id) => [id, new Texture({
  source: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1, format: "rgba8unorm" }),
})]));
const lookup = (id: ResourceId) => textures.get(id) as Texture;

function scene(): SceneDefinition {
  return {
    id: "scene.test" as never,
    resources: [resource("tex.a", "texture"), resource("tex.b", "texture")],
    layers: [layer("back", 0), layer("world", 1), layer("world.low", 0, "world"), layer("world.high", 1, "world"), layer("front", 2)],
    objects: [
      sprite("tree", { layerId: layerId("back"), texture: resourceId("tex.a") }),
      sprite("hero", { layerId: layerId("world.high"), texture: resourceId("tex.a"), sortKey: 5 }),
      sprite("crate", { layerId: layerId("world.high"), texture: resourceId("tex.b"), sortKey: 5 }),
      sprite("rock", { layerId: layerId("world.high"), texture: resourceId("tex.b"), sortKey: 1 }),
    ],
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

const graphOf = (definition = scene()) => new PixiSceneGraph(new SceneStore(definition), lookup);

describe("PixiSceneGraph", () => {
  it("draws layers parents-first by order, and objects by sortKey then ID", () => {
    const graph = graphOf();
    expect(graph.layerOrder()).toEqual(["back", "world", "world.low", "world.high", "front"]);
    expect(graph.drawOrder(layerId("world.high"))).toEqual(["rock", "crate", "hero"]);
    const world = graph.layerContainer(layerId("world"));
    expect(world?.children.map((child) => child.label)).toEqual(["objects", "layers"]);
  });

  it("applies sprite fields from the model", () => {
    const graph = graphOf();
    const store = graph.store;
    graph.apply(store.apply([{ op: "update", id: objectId("hero"), patch: {
      transform: { x: 5, y: 6, rotation: 180, scaleX: 2, scaleY: 3, mirrorX: true, mirrorY: false },
      anchor: { x: 0.5, y: 1 }, tint: 0x00ff00, alpha: 0.5, visible: false, texture: resourceId("tex.b"),
    } }]));
    const hero = graph.sprite(objectId("hero"));
    expect([hero?.x, hero?.y, hero?.rotation, hero?.scale.x, hero?.scale.y, hero?.anchor.x, hero?.anchor.y]).toEqual([5, 6, Math.PI, -2, 3, 0.5, 1]);
    expect([hero?.tint, hero?.alpha, hero?.visible, hero?.texture === textures.get("tex.b")]).toEqual([0x00ff00, 0.5, false, true]);
  });

  it("re-ranks only for order changes and moves objects between layers", () => {
    const graph = graphOf();
    const store = graph.store;
    graph.apply(store.apply([{ op: "update", id: objectId("hero"), patch: { sortKey: 0 } }]));
    expect(graph.drawOrder(layerId("world.high"))).toEqual(["hero", "rock", "crate"]);
    graph.apply(store.apply([{ op: "update", id: objectId("crate"), patch: { layerId: layerId("world.low") } }]));
    expect(graph.drawOrder(layerId("world.high"))).toEqual(["hero", "rock"]);
    expect(graph.drawOrder(layerId("world.low"))).toEqual(["crate"]);
    expect(graph.sprite(objectId("crate"))?.parent?.parent).toBe(graph.layerContainer(layerId("world.low")));
  });

  it("adds and removes objects and layers, destroying what leaves", () => {
    const graph = graphOf();
    const store = graph.store;
    const tree = graph.sprite(objectId("tree"));
    graph.apply(store.apply([
      { op: "remove", id: objectId("tree") },
      { op: "add-layer", layer: layer("world.mid", 2, "world") },
      { op: "add-layer", layer: layer("world.mid.detail", 0, "world.mid") },
      { op: "add", object: sprite("bird", { layerId: layerId("world.mid.detail"), texture: resourceId("tex.a") }) },
      { op: "set-layer", id: layerId("front"), patch: { visible: false, opacity: 0.25 } },
    ]));
    expect(tree?.destroyed).toBe(true);
    expect(graph.layerOrder()).toEqual(["back", "world", "world.low", "world.high", "world.mid", "world.mid.detail", "front"]);
    expect(graph.drawOrder(layerId("world.mid.detail"))).toEqual(["bird"]);
    expect([graph.layerContainer(layerId("front"))?.visible, graph.layerContainer(layerId("front"))?.alpha]).toEqual([false, 0.25]);
    const mid = graph.layerContainer(layerId("world.mid"));
    graph.apply(store.apply([
      { op: "remove", id: objectId("bird") },
      { op: "remove-layer", id: layerId("world.mid.detail") },
      { op: "remove-layer", id: layerId("world.mid") },
    ]));
    expect(mid?.destroyed).toBe(true);
    expect(graph.layerOrder()).toEqual(["back", "world", "world.low", "world.high", "front"]);
  });

  it("refuses scenes and additions it cannot present", () => {
    const definition = scene();
    const withHero = { ...definition, resources: [...definition.resources, resource("rig.chibi", "rig"), resource("anim.unarmed-idle", "animation"), resource("skin.blue-mage", "skin")],
      layers: [...definition.layers, layer("world.actors", 2, "world")], objects: [...definition.objects, character("npc")] };
    expect(() => graphOf(withHero)).toThrow(UnsupportedSceneError);
    expect(() => graphOf(withHero)).toThrow(/object npc: character objects are not presented yet/);
  });

  it("destroys every display object on destroy and leaves textures to their owner", () => {
    const graph = graphOf();
    const hero = graph.sprite(objectId("hero"));
    graph.destroy();
    expect([graph.root.destroyed, hero?.destroyed, textures.get("tex.a")?.destroyed]).toEqual([true, true, false]);
  });
});
