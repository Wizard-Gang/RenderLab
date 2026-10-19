// Shape validation for scene records. Shapes are closed: an unknown field is an error, never silently ignored
// (specification §11.5). Cross-record rules (references, uniqueness, the layer tree) live in the scene store.
import type { Failures } from "../contracts/errors";
import { checkId, type ResourceId } from "../contracts/ids";
import {
  checkBoolean, checkColor, checkFinite, checkInteger, checkTransform, checkUnit, checkVec2, isRecord,
} from "../contracts/values";
import { checkAnimation } from "../timeline/animation";
import { CHUNK_CELLS, RESOURCE_KINDS, type ResourceKind, type SceneObject, type SceneObjectKind } from "./model";

export function checkKeys(failures: Failures, path: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) failures.add(`${path}.${key}`, "is not a field of this record");
  }
  for (const key of allowed) {
    if (!(key in value)) failures.add(`${path}.${key}`, "is required");
  }
}

function checkText(failures: Failures, path: string, value: unknown, maxLength = 256): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    failures.add(path, `must be 1 to ${maxLength} characters without control characters`);
  }
}

export function checkSource(failures: Failures, path: string, value: unknown): void {
  if (value === null) return;
  if (!isRecord(value)) {
    failures.add(path, "must be null or a source { authority, id, path }");
    return;
  }
  checkKeys(failures, path, value, ["authority", "id", "path"]);
  checkText(failures, `${path}.authority`, value.authority);
  checkId(failures, `${path}.id`, value.id);
  if (!Array.isArray(value.path) || value.path.length > 64) failures.add(`${path}.path`, "must be a list of at most 64 IDs");
  else value.path.forEach((entry, index) => checkId(failures, `${path}.path[${index}]`, entry));
}

export function checkResource(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be a resource descriptor");
    return;
  }
  checkKeys(failures, path, value, ["id", "kind", "source"]);
  checkId(failures, `${path}.id`, value.id);
  if (!RESOURCE_KINDS.includes(value.kind as ResourceKind)) failures.add(`${path}.kind`, `must be one of ${RESOURCE_KINDS.join(", ")}`);
  checkSource(failures, `${path}.source`, value.source);
}

export const LAYER_FIELDS = Object.freeze([
  "id", "parentId", "order", "visible", "opacity", "space", "parallax", "occlusionFade", "role", "source",
]);
/** Fields a scene change may set on an existing layer. Identity and tree position never change in place. */
export const LAYER_PATCH_FIELDS = Object.freeze(["visible", "opacity", "parallax", "occlusionFade"]);

export function checkLayer(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be a layer descriptor");
    return;
  }
  checkKeys(failures, path, value, LAYER_FIELDS);
  checkId(failures, `${path}.id`, value.id);
  if (value.parentId !== null) checkId(failures, `${path}.parentId`, value.parentId);
  checkInteger(failures, `${path}.order`, value.order);
  checkBoolean(failures, `${path}.visible`, value.visible);
  checkUnit(failures, `${path}.opacity`, value.opacity);
  if (value.space !== "world" && value.space !== "screen") failures.add(`${path}.space`, 'must be "world" or "screen"');
  checkVec2(failures, `${path}.parallax`, value.parallax);
  if (value.occlusionFade !== null) checkUnit(failures, `${path}.occlusionFade`, value.occlusionFade);
  if (value.role !== null) checkText(failures, `${path}.role`, value.role, 64);
  checkSource(failures, `${path}.source`, value.source);
}

const BASE_FIELDS = ["id", "kind", "layerId", "mobility", "visible", "sortKey", "source"] as const;
const KIND_FIELDS: Record<SceneObjectKind, readonly string[]> = {
  sprite: ["transform", "texture", "anchor", "tint", "alpha"],
  "tile-chunk": ["tileset", "grid", "column", "row", "cells"],
  character: ["transform", "rig", "animation", "appearance", "presentation"],
  particles: ["transform", "effect", "budget"],
  effect: ["transform", "effect", "params"],
};
/** Fields a scene change may update in place, per kind. `id`, `kind`, `mobility`, `source` and a chunk's grid and
 * coordinates never change in place; replacing them is a remove and an add. */
export const PATCH_FIELDS: Record<SceneObjectKind, readonly string[]> = {
  sprite: ["layerId", "visible", "sortKey", "transform", "texture", "anchor", "tint", "alpha"],
  "tile-chunk": ["layerId", "visible", "sortKey", "tileset", "cells"],
  character: ["layerId", "visible", "sortKey", "transform", "animation", "appearance", "presentation"],
  particles: ["layerId", "visible", "sortKey", "transform", "effect", "budget"],
  effect: ["layerId", "visible", "sortKey", "transform", "effect", "params"],
};
export const OBJECT_KINDS = Object.freeze(Object.keys(KIND_FIELDS) as SceneObjectKind[]);

export function checkTileCell(failures: Failures, path: string, value: unknown): void {
  if (value === null) return;
  if (!isRecord(value)) {
    failures.add(path, "must be null or a tile cell");
    return;
  }
  checkKeys(failures, path, value, ["tile", "quarterTurns", "mirrorX", "mirrorY"]);
  checkId(failures, `${path}.tile`, value.tile);
  if (![0, 1, 2, 3].includes(value.quarterTurns as number)) failures.add(`${path}.quarterTurns`, "must be 0, 1, 2 or 3");
  checkBoolean(failures, `${path}.mirrorX`, value.mirrorX);
  checkBoolean(failures, `${path}.mirrorY`, value.mirrorY);
}

function checkKindFields(failures: Failures, path: string, value: Record<string, unknown>, kind: SceneObjectKind): void {
  if (kind !== "tile-chunk") checkTransform(failures, `${path}.transform`, value.transform);
  if (kind === "sprite") {
    checkId(failures, `${path}.texture`, value.texture);
    checkVec2(failures, `${path}.anchor`, value.anchor);
    checkColor(failures, `${path}.tint`, value.tint);
    checkUnit(failures, `${path}.alpha`, value.alpha);
  } else if (kind === "tile-chunk") {
    checkId(failures, `${path}.tileset`, value.tileset);
    if (value.mobility !== "static") failures.add(`${path}.mobility`, 'must be "static" for a tile chunk');
    if (!isRecord(value.grid)) failures.add(`${path}.grid`, "must be a grid { origin, cellSize }");
    else {
      checkKeys(failures, `${path}.grid`, value.grid, ["origin", "cellSize"]);
      checkVec2(failures, `${path}.grid.origin`, value.grid.origin);
      checkVec2(failures, `${path}.grid.cellSize`, value.grid.cellSize);
      const size = value.grid.cellSize;
      if (isRecord(size) && ((size.x as number) <= 0 || (size.y as number) <= 0)) failures.add(`${path}.grid.cellSize`, "must be positive");
    }
    checkInteger(failures, `${path}.column`, value.column);
    checkInteger(failures, `${path}.row`, value.row);
    if (!Array.isArray(value.cells) || value.cells.length !== CHUNK_CELLS) failures.add(`${path}.cells`, `must list exactly ${CHUNK_CELLS} cells`);
    else value.cells.forEach((cell, index) => checkTileCell(failures, `${path}.cells[${index}]`, cell));
  } else if (kind === "character") {
    checkId(failures, `${path}.rig`, value.rig);
    checkAnimation(failures, `${path}.animation`, value.animation);
    checkAppearance(failures, `${path}.appearance`, value.appearance);
    if (value.presentation !== "articulated" && value.presentation !== "baked") failures.add(`${path}.presentation`, 'must be "articulated" or "baked"');
  } else if (kind === "particles") {
    checkId(failures, `${path}.effect`, value.effect);
    checkInteger(failures, `${path}.budget`, value.budget, 0);
  } else {
    checkId(failures, `${path}.effect`, value.effect);
    if (!isRecord(value.params) || Object.keys(value.params).length > 64) failures.add(`${path}.params`, "must be a record of at most 64 numbers");
    else for (const [name, param] of Object.entries(value.params)) checkFinite(failures, `${path}.params.${name}`, param);
  }
}

function checkAppearance(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be an appearance { skin, palette, equipment }");
    return;
  }
  checkKeys(failures, path, value, ["skin", "palette", "equipment"]);
  if (value.skin !== null) checkId(failures, `${path}.skin`, value.skin);
  if (value.palette !== null) checkId(failures, `${path}.palette`, value.palette);
  if (!Array.isArray(value.equipment) || value.equipment.length > 64) failures.add(`${path}.equipment`, "must be a list of at most 64 IDs");
  else value.equipment.forEach((entry, index) => checkId(failures, `${path}.equipment[${index}]`, entry));
}

export function checkObject(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be a scene object");
    return;
  }
  const kind = value.kind as SceneObjectKind;
  if (!OBJECT_KINDS.includes(kind)) {
    failures.add(`${path}.kind`, `must be one of ${OBJECT_KINDS.join(", ")}`);
    return;
  }
  checkKeys(failures, path, value, [...BASE_FIELDS, ...KIND_FIELDS[kind]]);
  checkId(failures, `${path}.id`, value.id);
  checkId(failures, `${path}.layerId`, value.layerId);
  if (value.mobility !== "static" && value.mobility !== "dynamic") failures.add(`${path}.mobility`, 'must be "static" or "dynamic"');
  checkBoolean(failures, `${path}.visible`, value.visible);
  checkFinite(failures, `${path}.sortKey`, value.sortKey);
  checkSource(failures, `${path}.source`, value.source);
  checkKindFields(failures, path, value, kind);
}


/** Every resource an object references, with the kind it must have and the field that names it. */
export function resourceReferences(object: SceneObject): [ResourceId, ResourceKind, string][] {
  switch (object.kind) {
    case "sprite":
      return [[object.texture, "texture", "texture"]];
    case "tile-chunk":
      return [[object.tileset, "tileset", "tileset"]];
    case "character": {
      const refs: [ResourceId, ResourceKind, string][] = [[object.rig, "rig", "rig"], [object.animation.clip, "animation", "animation.clip"]];
      if (object.appearance.skin !== null) refs.push([object.appearance.skin, "skin", "appearance.skin"]);
      if (object.appearance.palette !== null) refs.push([object.appearance.palette, "palette", "appearance.palette"]);
      object.appearance.equipment.forEach((id, index) => refs.push([id, "equipment", `appearance.equipment[${index}]`]));
      return refs;
    }
    case "particles":
    case "effect":
      return [[object.effect, "effect", "effect"]];
  }
}
