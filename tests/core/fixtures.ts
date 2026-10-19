import {
  CHUNK_CELLS, IDENTITY_TRANSFORM, layerId, objectId, resourceId, sceneId,
  type CharacterObject, type LayerDescriptor, type ResourceDescriptor, type ResourceKind, type SceneDefinition,
  type SpriteObject, type TileCell, type TileChunkObject,
} from "../../src/core";

/** mulberry32: a tiny seeded PRNG, so "random" sequences are identical on every run and machine. */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const resource = (id: string, kind: ResourceKind): ResourceDescriptor => ({ id: resourceId(id), kind, source: null });

export function layer(id: string, order: number, parentId: string | null = null, extra: Partial<LayerDescriptor> = {}): LayerDescriptor {
  return {
    id: layerId(id), parentId: parentId === null ? null : layerId(parentId), order, visible: true, opacity: 1, space: "world",
    parallax: { x: 1, y: 1 }, occlusionFade: null, role: null, source: null, ...extra,
  };
}

export function sprite(id: string, extra: Partial<SpriteObject> = {}): SpriteObject {
  return {
    kind: "sprite", id: objectId(id), layerId: layerId("world.props"), mobility: "dynamic", visible: true, sortKey: 0, source: null,
    transform: IDENTITY_TRANSFORM, texture: resourceId("tex.crate"), anchor: { x: 0.5, y: 1 }, tint: 0xffffff, alpha: 1, ...extra,
  };
}

export const cell = (tile: string, quarterTurns: 0 | 1 | 2 | 3 = 0): TileCell => ({ tile, quarterTurns, mirrorX: false, mirrorY: false });

export function chunk(column: number, row: number, extra: Partial<TileChunkObject> = {}): TileChunkObject {
  const cells: (TileCell | null)[] = new Array(CHUNK_CELLS).fill(null);
  cells[0] = cell("grass");
  return {
    kind: "tile-chunk", id: objectId(`chunk.${column}.${row}`), layerId: layerId("world.terrain"), mobility: "static", visible: true,
    sortKey: 0, source: { authority: "maplab:map.forest", id: "terrain", path: [] }, tileset: resourceId("tileset.forest"),
    grid: { origin: { x: 0, y: 0 }, cellSize: { x: 16, y: 16 } }, column, row, cells, ...extra,
  };
}

export function character(id: string, extra: Partial<CharacterObject> = {}): CharacterObject {
  return {
    kind: "character", id: objectId(id), layerId: layerId("world.actors"), mobility: "dynamic", visible: true, sortKey: 10, source: null,
    transform: IDENTITY_TRANSFORM, rig: resourceId("rig.chibi"),
    animation: { clip: resourceId("anim.unarmed-idle"), entryTick: 0, facing: "right", pausedAtTick: null },
    appearance: { skin: resourceId("skin.blue-mage"), palette: null, equipment: [] }, presentation: "articulated", ...extra,
  };
}

/** A small world: a background, a terrain layer, a props layer and an actors group, with one of each object. */
export function definition(): SceneDefinition {
  return {
    id: sceneId("scene.forest"),
    resources: [
      resource("tex.crate", "texture"), resource("tex.barrel", "texture"), resource("tileset.forest", "tileset"),
      resource("rig.chibi", "rig"), resource("anim.unarmed-idle", "animation"), resource("anim.unarmed-walk", "animation"),
      resource("skin.blue-mage", "skin"), resource("fx.dust", "effect"),
    ],
    layers: [
      layer("background", 0, null, { space: "world", parallax: { x: 0.25, y: 0.25 }, role: "background" }),
      layer("world", 1),
      layer("world.terrain", 0, "world", { role: "tile" }),
      layer("world.props", 1, "world", { role: "sprite" }),
      layer("world.actors", 2, "world", { role: "actors" }),
      layer("hud", 2, null, { space: "screen", parallax: { x: 0, y: 0 } }),
    ],
    objects: [sprite("crate.1"), chunk(0, 0), character("hero")],
    camera: { x: 0, y: 0, zoom: 2, bounds: null },
  };
}
