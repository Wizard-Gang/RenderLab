import type { JsonValue } from "../../assets";
import {
  CHUNK_CELLS, layerId, objectId, resourceId, sceneId,
  type LayerDescriptor, type ResourceDescriptor, type SceneDefinition, type SceneObject, type ShapeGeometry, type SourceRef,
  type TileCell, type Transform2D, type Vec2,
} from "../../core";
import type { Closure } from "./closure";
import { isObject, type JsonObject, type MapLabDocument } from "./documents";
import { MapLabError } from "./errors";

// Specification §8.1 steps 10–11: one renderer-neutral scene per bundled map, and the map's source-ID-to-runtime-handle
// map. MapLab's IDs pass through unchanged (§8.6); the only derived IDs are terrain chunk handles, named by their
// layer, tileset and chunk coordinates. Content RenderLab cannot present yet is refused, never dropped (§8.1).

/** Background-layer fields the core layer model has no slot for yet; RLDR-010's composition reads them. */
export interface BackgroundLayout {
  readonly space: "world" | "camera";
  readonly origin: Vec2;
  readonly repeat: "none" | "x" | "y" | "xy";
  readonly repeatSize: Vec2;
  readonly scrollPerTick: Vec2;
  readonly phase: Vec2;
}

/** What one map source ID became. `handle` is null for content read as a reference only (bodies, regions, entities…). */
export interface MapLabHandle {
  readonly collection: string;
  readonly handle: { readonly kind: "layer" | "object" | "resource"; readonly id: string } | null;
  /** For prefab-expanded content: the placement that expanded it and the prefab it came from. */
  readonly expandedFrom: { readonly placementId: string; readonly prefabId: string } | null;
}

export interface MapLabScene {
  readonly mapId: string;
  readonly path: string;
  readonly definition: SceneDefinition;
  readonly backgrounds: ReadonlyMap<string, BackgroundLayout>;
  readonly handles: ReadonlyMap<string, MapLabHandle>;
}

const list = (value: JsonValue | undefined): readonly JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);
const vec = (value: JsonValue | undefined): Vec2 => ({ x: (value as number[])[0]!, y: (value as number[])[1]! });

function transformOf(value: JsonObject, scale = 1): Transform2D {
  const [x, y] = value.position as number[];
  const [scaleX, scaleY] = value.scale as number[];
  return { x: x!, y: y!, rotation: value.rotation as number, scaleX: scaleX! * scale, scaleY: scaleY! * scale, mirrorX: value.mirrorX as boolean, mirrorY: value.mirrorY as boolean };
}

function geometryOf(shape: JsonObject): ShapeGeometry {
  if (shape.kind === "rect") {
    const [x, y, width, height] = shape.rect as number[];
    return { kind: "rect", x: x!, y: y!, width: width!, height: height! };
  }
  if (shape.kind === "circle") return { kind: "circle", center: vec(shape.center), radius: shape.radius as number };
  return { kind: "polygon", points: (shape.points as JsonValue[]).map(vec) };
}

/** `#RRGGBB` or `#RRGGBBAA` → 0xRRGGBB and alpha. */
function colorOf(text: string): { fill: number; alpha: number } {
  return { fill: Number.parseInt(text.slice(1, 7), 16), alpha: text.length === 9 ? Number.parseInt(text.slice(7, 9), 16) / 255 : 1 };
}

function layersOf(map: MapLabDocument, source: (id: string) => SourceRef, backgrounds: Map<string, BackgroundLayout>): LayerDescriptor[] {
  return list(map.value.layers).map((layer) => {
    const id = layer.id as string;
    const background = layer.kind === "background";
    if (background) {
      backgrounds.set(id, {
        space: layer.space as "world" | "camera", origin: vec(layer.origin), repeat: layer.repeat as BackgroundLayout["repeat"],
        repeatSize: vec(layer.repeatSize), scrollPerTick: vec(layer.scrollWUPerTick), phase: vec(layer.phase),
      });
    }
    return {
      id: layerId(id),
      parentId: layer.parentId === null ? null : layerId(layer.parentId as string),
      order: layer.order as number,
      visible: layer.visible as boolean,
      opacity: layer.opacity as number,
      space: background && layer.space === "camera" ? "screen" : "world",
      parallax: background ? vec(layer.parallax) : { x: 1, y: 1 },
      occlusionFade: (layer.occlusionFade as number | null | undefined) ?? null,
      role: layer.kind as string,
      source: source(id),
    };
  });
}

function terrainOf(map: MapLabDocument, closure: Closure, authority: string): SceneObject[] {
  const objects: SceneObject[] = [];
  list(map.value.terrain).forEach((terrain, t) => {
    const tilesetId = terrain.tilesetId as string;
    const tiles = new Set(list(closure.documents.get(tilesetId)!.value.tiles).map((tile) => tile.id as string));
    const seen = new Set<string>();
    list(terrain.chunks).forEach((chunk, c) => {
      const at = `$.terrain[${t}].chunks[${c}]`;
      const id = `${String(terrain.layerId)}:${tilesetId}:chunk:${String(chunk.column)},${String(chunk.row)}`;
      if (seen.has(id)) throw new MapLabError("object.duplicate", map.path, at, `chunk ${String(chunk.column)},${String(chunk.row)} appears twice in this terrain`);
      seen.add(id);
      const cells = (chunk.cells as JsonValue[]).map((cell, k): TileCell | null => {
        if (!isObject(cell)) return null;
        if (!tiles.has(cell.tileId as string)) throw new MapLabError("reference.dangling", map.path, `${at}.cells[${k}].tileId`, `${String(cell.tileId)} is not a tile of ${tilesetId}`);
        return { tile: cell.tileId as string, quarterTurns: cell.quarterTurns as TileCell["quarterTurns"], mirrorX: cell.mirrorX as boolean, mirrorY: cell.mirrorY as boolean };
      });
      if (cells.length !== CHUNK_CELLS) throw new MapLabError("schema.minItems", map.path, `${at}.cells`, `a chunk holds exactly ${CHUNK_CELLS} cells`);
      objects.push({
        id: objectId(id), kind: "tile-chunk", layerId: layerId(terrain.layerId as string), mobility: "static", visible: true, sortKey: t,
        source: { authority, id: terrain.layerId as string, path: [] },
        tileset: resourceId(tilesetId), grid: { origin: vec(terrain.origin), cellSize: vec(terrain.cellSize) },
        column: chunk.column as number, row: chunk.row as number, cells,
      });
    });
  });
  return objects;
}

function visualsOf(map: MapLabDocument, authority: string, expanded: ReadonlyMap<string, MapLabHandle["expandedFrom"]>): SceneObject[] {
  const assets = new Map(list(map.value.assets).map((asset) => [asset.id as string, asset]));
  const moving = new Set(list(map.value.bodies).filter((body) => body.mobility !== "static").map((body) => body.id as string));
  return list(map.value.visuals).map((visual, i): SceneObject => {
    const id = visual.id as string;
    const at = `$.visuals[${i}]`;
    if (visual.parentId !== null) throw new MapLabError("adapter.unsupported", map.path, `${at}.parentId`, "nested visual transforms are composed by MapLab layer composition (RLDR-010), which this reader does not yet do");
    const placement = expanded.get(id) ?? null;
    const base = {
      id: objectId(id), layerId: layerId(visual.layerId as string), visible: true, sortKey: visual.order as number,
      mobility: typeof visual.bodyId === "string" && moving.has(visual.bodyId) ? "dynamic" as const : "static" as const,
      source: { authority, id, path: placement ? [placement.placementId] : [] },
    };
    const source = visual.source as JsonObject;
    if (source.kind === "shape") return { ...base, kind: "shape", transform: transformOf(visual.transform as JsonObject), geometry: geometryOf(source.shape as JsonObject), ...colorOf(source.fill as string) };
    if (source.kind === "asset") {
      const asset = assets.get(source.assetId as string)!;
      const [width, height] = asset.size as number[];
      if (!String(asset.mediaType).startsWith("image/") || !width || !height) {
        throw new MapLabError("reference.kind", map.path, `${at}.source.assetId`, `${String(asset.id)} must be an image with a non-zero size`);
      }
      const [pivotX, pivotY] = source.pivot as number[];
      return {
        ...base, kind: "sprite", transform: transformOf(visual.transform as JsonObject, asset.wuPerAssetUnit as number), texture: resourceId(asset.id as string),
        anchor: { x: pivotX! / width, y: pivotY! / height }, tint: 0xffffff, alpha: 1,
      };
    }
    throw new MapLabError("adapter.unsupported", map.path, `${at}.source`, "frame-sequence visuals are presented with baked sprite frames (RLDR-014), which this reader does not yet do");
  });
}

export function buildScene(map: MapLabDocument, closure: Closure): MapLabScene {
  const value = map.value;
  if (list(value.presentations).length > 0) {
    throw new MapLabError("adapter.unsupported", map.path, "$.presentations", "RigLab presentations are read by the RigLab adapter (RLDR-011), which this reader does not yet use");
  }
  const authority = `maplab:${map.id}`;
  const source = (id: string): SourceRef => ({ authority, id, path: [] });
  const expanded = new Map<string, MapLabHandle["expandedFrom"]>();
  for (const placement of list(value.prefabPlacements)) {
    for (const id of placement.expandedIds as string[]) expanded.set(id, { placementId: placement.id as string, prefabId: placement.prefabId as string });
  }
  const backgrounds = new Map<string, BackgroundLayout>();
  const layers = layersOf(map, source, backgrounds);
  const objects = [...terrainOf(map, closure, authority), ...visualsOf(map, authority, expanded)];
  const tilesets = [...new Set(list(value.terrain).map((terrain) => terrain.tilesetId as string))];
  const imageAssets = list(value.assets).filter((asset) => String(asset.mediaType).startsWith("image/"));
  const resources: ResourceDescriptor[] = [
    ...tilesets.map((id): ResourceDescriptor => ({ id: resourceId(id), kind: "tileset", source: { authority: "maplab", id, path: [] } })),
    ...imageAssets.map((asset): ResourceDescriptor => ({ id: resourceId(asset.id as string), kind: "texture", source: source(asset.id as string) })),
  ];
  const [x, y, width, height] = (value.camera as { defaults: { bounds: number[] } }).defaults.bounds as [number, number, number, number];
  const zoom = (value.camera as { defaults: { zoom: number } }).defaults.zoom;
  const definition: SceneDefinition = {
    id: sceneId(authority), resources, layers, objects,
    camera: { x: x + width / 2, y: y + height / 2, zoom, bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height } },
  };

  const handles = new Map<string, MapLabHandle>();
  const presented: Readonly<Record<string, "layer" | "object" | "resource">> = { layers: "layer", visuals: "object", assets: "resource" };
  for (const [collection, member] of Object.entries(value)) {
    for (const item of list(member)) {
      if (typeof item.id !== "string" || collection === "dependencies" || collection === "requiredFeatures") continue;
      const kind = presented[collection];
      handles.set(item.id, { collection, handle: kind ? { kind, id: item.id } : null, expandedFrom: expanded.get(item.id) ?? null });
    }
  }
  const nested: readonly (readonly [string, readonly JsonObject[]])[] = [
    ["camera.zones", list((value.camera as JsonObject).zones)], ["environment.zones", list((value.environment as JsonObject).zones)],
    ...["modeVolumes", "links", "overrides"].map((field) => [`navigation.${field}`, list((value.navigation as JsonObject)[field])] as const),
    ["bodies.shapes", list(value.bodies).flatMap((body) => list(body.shapes))],
    ["traversals.access", list(value.traversals).flatMap((traversal) => list(traversal.access))],
  ];
  for (const [collection, items] of nested) {
    for (const item of items) handles.set(item.id as string, { collection, handle: null, expandedFrom: expanded.get(item.id as string) ?? null });
  }
  return { mapId: map.id, path: map.path, definition, backgrounds, handles };
}
