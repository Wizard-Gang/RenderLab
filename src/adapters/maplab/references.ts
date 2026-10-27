import type { AssetBundle, JsonValue } from "../../assets";
import type { Closure } from "./closure";
import { dependenciesOf } from "./closure";
import { ASSET_MEDIA, extensionOf } from "./contracts";
import { assetPathProblem, isObject, type JsonObject, type MapLabDocument } from "./documents";
import { MapLabError } from "./errors";

// Specification §8.1 step 8: semantic references in maps and tilesets. Object IDs are unique across a map's
// collections, and every ID-bearing field the v1 schemas define resolves to an object of the expected kind, a
// document in the map's closure, or a dependency the map itself declares. Catalog calls (`params` of actions,
// events and abilities) and movement documents are engine semantics: RenderLab checks their schema and contracts,
// never their meaning (§3.1, §8.5).

/** Top-level map collections in namespace order, each with the kind of object it holds. */
const COLLECTIONS: readonly (readonly [string, string])[] = [
  ["assets", "asset"], ["presentations", "presentation"], ["layers", "layer"], ["visuals", "visual"], ["materials", "material"],
  ["bodies", "body"], ["footholds", "foothold"], ["traversals", "traversal"], ["regions", "region"], ["entities", "entity"],
  ["waypoints", "waypoint"], ["routes", "route"], ["triggers", "trigger"], ["encounters", "encounter"], ["flags", "flag"],
  ["prefabPlacements", "prefab-placement"],
];
const NESTED: readonly (readonly [string, string, string])[] = [
  ["camera", "zones", "camera-zone"], ["environment", "zones", "environment-zone"], ["navigation", "modeVolumes", "nav-volume"],
  ["navigation", "links", "nav-link"], ["navigation", "overrides", "nav-override"],
];

/** ID-bearing fields → what they name: an object kind, `any` object, `doc:` a closure document, `dep:` a declared dependency. */
const FIELDS: Readonly<Record<string, string>> = {
  footholdId: "foothold", bodyId: "body", ownerBodyId: "body", bodyIds: "body", entityId: "entity", spawnIds: "entity",
  assetId: "asset", assetIds: "asset", trackAssetId: "asset", layerId: "layer", planeId: "layer", materialId: "material",
  shapeId: "shape", visualId: "visual", regionId: "region", approachRegionId: "region", patrolRegionId: "region",
  pursuitRegionId: "region", leashRegionId: "region", aggroRegionId: "region", waypointIds: "waypoint", routeId: "route",
  presentationId: "presentation", expandedIds: "any", movementId: "doc:maplab.movement", profileIds: "doc:maplab.movement",
  tilesetId: "dep:tileset", prefabId: "dep:prefab",
};

const list = (value: JsonValue | undefined): readonly JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);

function namespace(map: MapLabDocument): Map<string, string> {
  const ids = new Map<string, string>();
  const add = (id: JsonValue | undefined, kind: string, at: string) => {
    if (typeof id !== "string") return;
    if (ids.has(id)) throw new MapLabError("object.duplicate", map.path, at, `the object ID ${id} is already used in this map`);
    ids.set(id, kind);
  };
  const value = map.value;
  for (const [collection, kind] of COLLECTIONS) list(value[collection]).forEach((item, i) => add(item.id, kind, `$.${collection}[${i}].id`));
  for (const [parent, field, kind] of NESTED) {
    const owner = value[parent];
    if (isObject(owner)) list(owner[field]).forEach((item, i) => add(item.id, kind, `$.${parent}.${field}[${i}].id`));
  }
  list(value.bodies).forEach((body, i) => list(body.shapes).forEach((shape, j) => add(shape.id, "shape", `$.bodies[${i}].shapes[${j}].id`)));
  list(value.traversals).forEach((traversal, i) => list(traversal.access).forEach((access, j) => add(access.id, "access", `$.traversals[${i}].access[${j}].id`)));
  const groupLayers = new Set(list(value.layers).filter((layer) => layer.kind === "group").map((layer) => layer.id as string));
  for (const collection of ["entities", "encounters"]) {
    list(value[collection]).forEach((item, i) => {
      const group = item.groupId;
      if (typeof group !== "string") return;
      if (ids.has(group) && !groupLayers.has(group)) throw new MapLabError("object.duplicate", map.path, `$.${collection}[${i}].groupId`, `the group ${group} collides with an object ID`);
    });
  }
  return ids;
}

function checkMap(bundle: AssetBundle, closure: Closure, map: MapLabDocument): void {
  const ids = namespace(map);
  const declared = new Map(dependenciesOf(map).map((dependency) => [dependency.id as string, dependency.kind as string]));
  const inClosure = closure.reach.get(map.id)!;
  const resolve = (target: string, id: string, at: string) => {
    if (target === "any" ? ids.has(id) : ids.get(id) === target) return;
    if (target.startsWith("dep:")) {
      if (declared.get(id) === target.slice(4)) return;
      const bundled = closure.documents.get(id);
      throw new MapLabError(bundled ? "reference.undeclared" : "reference.dangling", map.path, at, `${id} must be a ${target.slice(4)} this map declares`);
    }
    if (target.startsWith("doc:")) {
      const document = closure.documents.get(id);
      if (document?.format === target.slice(4) && inClosure.has(id)) return;
      throw new MapLabError(document ? "reference.undeclared" : "reference.dangling", map.path, at, `${id} must be a ${target.slice(4)} in this map's dependency closure`);
    }
    throw new MapLabError(ids.has(id) ? "reference.kind" : "reference.dangling", map.path, at, `${id} must name a ${target} of this map`);
  };
  const scan = (value: JsonValue, at: string, owner: string | null): void => {
    if (Array.isArray(value)) return value.forEach((item, i) => scan(item, `${at}[${i}]`, owner));
    if (!isObject(value)) return;
    for (const [key, member] of Object.entries(value)) {
      const here = `${at}.${key}`;
      if (key === "params" || key === "destination") continue;
      const target = key === "parentId" ? owner : FIELDS[key];
      if (target && typeof member === "string") resolve(target, member, here);
      else if (target && Array.isArray(member)) member.forEach((id, i) => typeof id === "string" && resolve(target, id, `${here}[${i}]`));
      else scan(member, here, owner);
    }
  };
  for (const [key, member] of Object.entries(map.value)) {
    const kind = COLLECTIONS.find(([collection]) => collection === key)?.[1] ?? null;
    scan(member, `$.${key}`, kind);
  }
  checkPortals(closure, map);
  list(map.value.assets).forEach((asset, i) => {
    const path = asset.path as string;
    const at = `$.assets[${i}].path`;
    const problem = assetPathProblem(bundle, path);
    if (problem === "asset.path") throw new MapLabError("asset.path", map.path, at, `${path} is not a safe bundle path`);
    if (ASSET_MEDIA[extensionOf(path)] !== asset.mediaType) throw new MapLabError("asset.extension", map.path, at, `${path} does not match ${String(asset.mediaType)}`);
    if (problem) throw new MapLabError(problem, map.path, at, `${path} is not a bundled asset`);
  });
}

function checkPortals(closure: Closure, map: MapLabDocument): void {
  list(map.value.entities).forEach((entity, i) => {
    if (!isObject(entity.destination)) return;
    const { mapId, entityId } = entity.destination as { mapId: string; entityId: string };
    const at = `$.entities[${i}].destination`;
    const target = closure.documents.get(mapId);
    if (target?.format !== "maplab.map") throw new MapLabError("portal.map", map.path, `${at}.mapId`, `${mapId} is not a bundled map`);
    if (mapId !== map.id && !closure.reach.get(map.id)!.has(mapId)) throw new MapLabError("reference.undeclared", map.path, `${at}.mapId`, `${mapId} is not in this map's dependency closure`);
    if (!list(target.value.entities).some((candidate) => candidate.id === entityId)) {
      throw new MapLabError("portal.entity", map.path, `${at}.entityId`, `${mapId} has no entity ${entityId}`);
    }
  });
}

function checkTileset(tileset: MapLabDocument): void {
  const ids = new Map<string, string>();
  for (const [collection, kind] of [["assets", "asset"], ["terrains", "terrain"], ["rules", "rule"], ["tiles", "tile"]] as const) {
    list(tileset.value[collection]).forEach((item, i) => {
      if (ids.has(item.id as string)) throw new MapLabError("object.duplicate", tileset.path, `$.${collection}[${i}].id`, `the tileset object ID ${String(item.id)} is already used`);
      ids.set(item.id as string, kind);
    });
  }
  list(tileset.value.tiles).forEach((tile, i) => {
    const local = new Set<string>();
    list(tile.traceShapes).forEach((shape, j) => {
      if (local.has(shape.id as string)) throw new MapLabError("object.duplicate", tileset.path, `$.tiles[${i}].traceShapes[${j}].id`, `the trace shape ${String(shape.id)} is already used`);
      local.add(shape.id as string);
    });
  });
  const expect = (id: JsonValue | undefined, kind: string, at: string) => {
    if (typeof id === "string" && ids.get(id) !== kind) throw new MapLabError(ids.has(id) ? "reference.kind" : "reference.dangling", tileset.path, at, `${id} must name a ${kind} of this tileset`);
  };
  list(tileset.value.tiles).forEach((tile, i) => {
    expect(tile.terrainId, "terrain", `$.tiles[${i}].terrainId`);
    if (isObject(tile.visual)) expect(tile.visual.assetId, "asset", `$.tiles[${i}].visual.assetId`);
  });
  list(tileset.value.terrains).forEach((terrain, i) => expect(terrain.fallbackTileId, "tile", `$.terrains[${i}].fallbackTileId`));
  list(tileset.value.rules).forEach((rule, i) => {
    expect(rule.terrainId, "terrain", `$.rules[${i}].terrainId`);
    (Array.isArray(rule.outputTileIds) ? rule.outputTileIds : []).forEach((id, j) => expect(id, "tile", `$.rules[${i}].outputTileIds[${j}]`));
  });
}

export function checkReferences(bundle: AssetBundle, closure: Closure): void {
  for (const document of closure.documents.values()) {
    if (document.format === "maplab.map") checkMap(bundle, closure, document);
    else if (document.format === "maplab.tileset") checkTileset(document);
  }
}
