// Staging one scene change inside a store transaction. A change that fails its own checks is reported and not staged;
// the transaction then rejects as a whole, so the store never holds a partly applied delta.
import { checkCamera, type CameraState } from "../camera/state";
import type { Failures } from "../contracts/errors";
import { checkId, type LayerId, type ObjectId, type ResourceId } from "../contracts/ids";
import { isRecord } from "../contracts/values";
import { freezeCopy } from "./data";
import type { SceneChange } from "./delta";
import { CHUNK_CELLS, type LayerDescriptor, type ResourceDescriptor, type SceneObject, type TileCell } from "./model";
import {
  checkKeys, checkLayer, checkObject, checkResource, checkTileCell, LAYER_PATCH_FIELDS, PATCH_FIELDS, resourceReferences,
} from "./validate";

export interface Staging {
  readonly resources: Map<ResourceId, ResourceDescriptor | null>;
  readonly layers: Map<LayerId, LayerDescriptor | null>;
  readonly objects: Map<ObjectId, SceneObject | null>;
  readonly refDelta: Map<ResourceId, number>;
  readonly useDelta: Map<LayerId, number>;
  readonly slots: Map<string, ObjectId | null>;
  camera: CameraState | null;
  readonly removedResources: Set<ResourceId>;
  resource(id: ResourceId): ResourceDescriptor | undefined;
  layer(id: LayerId): LayerDescriptor | undefined;
  object(id: ObjectId): SceneObject | undefined;
  slot(key: string): ObjectId | undefined;
}

type SlotKey = (object: SceneObject) => string | null;

const CHANGE_FIELDS: Record<SceneChange["op"], readonly string[]> = {
  "add-resource": ["op", "resource"],
  "remove-resource": ["op", "id"],
  "add-layer": ["op", "layer"],
  "remove-layer": ["op", "id"],
  "set-layer": ["op", "id", "patch"],
  add: ["op", "object"],
  remove: ["op", "id"],
  update: ["op", "id", "patch"],
  "set-cells": ["op", "id", "cells"],
  "set-camera": ["op", "camera"],
};

const bump = <K>(map: Map<K, number>, key: K, delta: number) => map.set(key, (map.get(key) ?? 0) + delta);

function track(staging: Staging, object: SceneObject, sign: 1 | -1): void {
  for (const [resource] of resourceReferences(object)) bump(staging.refDelta, resource, sign);
  bump(staging.useDelta, object.layerId, sign);
}

function claimSlot(staging: Staging, failures: Failures, path: string, object: SceneObject, slotKey: SlotKey): void {
  const key = slotKey(object);
  if (key === null || object.kind !== "tile-chunk") return;
  const holder = staging.slot(key);
  if (holder !== undefined && holder !== object.id) {
    failures.add(path, `chunk (${object.column}, ${object.row}) on layer ${object.layerId} is already held by ${holder}`);
  } else staging.slots.set(key, object.id);
}

function releaseSlot(staging: Staging, object: SceneObject, slotKey: SlotKey): void {
  const key = slotKey(object);
  if (key !== null && staging.slot(key) === object.id) staging.slots.set(key, null);
}

function checkPatch(failures: Failures, path: string, patch: unknown, allowed: readonly string[]): patch is Record<string, unknown> {
  if (!isRecord(patch) || Object.keys(patch).length === 0) {
    failures.add(path, "must be a non-empty record of fields to change");
    return false;
  }
  const refused = Object.keys(patch).filter((key) => !allowed.includes(key));
  for (const key of refused) failures.add(`${path}.${key}`, "cannot be changed in place");
  return refused.length === 0;
}

function existing<T>(failures: Failures, path: string, id: unknown, found: (id: never) => T | undefined, noun: string): T | undefined {
  const before = failures.list.length;
  checkId(failures, path, id);
  if (failures.list.length > before) return undefined;
  const value = found(id as never);
  if (!value) failures.add(path, `${noun} ${String(id)} does not exist`);
  return value;
}

function stageCells(staging: Staging, failures: Failures, path: string, object: SceneObject, cells: unknown): void {
  if (object.kind !== "tile-chunk") {
    failures.add(`${path}.id`, `object ${object.id} is a ${object.kind}, not a tile chunk`);
    return;
  }
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > CHUNK_CELLS) {
    failures.add(`${path}.cells`, `must list 1 to ${CHUNK_CELLS} cell changes`);
    return;
  }
  const before = failures.list.length;
  const next = [...object.cells];
  const seen = new Set<number>();
  cells.forEach((entry: unknown, index) => {
    const at = `${path}.cells[${index}]`;
    if (!isRecord(entry)) return failures.add(at, "must be a cell change { index, cell }");
    checkKeys(failures, at, entry, ["index", "cell"]);
    checkTileCell(failures, `${at}.cell`, entry.cell);
    const cellIndex = entry.index as number;
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= CHUNK_CELLS) failures.add(`${at}.index`, `must be a whole number below ${CHUNK_CELLS}`);
    else if (seen.has(cellIndex)) failures.add(`${at}.index`, `cell ${cellIndex} is changed twice`);
    else {
      seen.add(cellIndex);
      next[cellIndex] = (entry.cell ?? null) as TileCell | null;
    }
  });
  if (failures.list.length === before) staging.objects.set(object.id, freezeCopy({ ...object, cells: next }));
}

/** `payload` names the added record's own path in failures; it defaults to the change's field (`delta[3].object`). */
export function stageChange(staging: Staging, failures: Failures, path: string, change: unknown, slotKey: SlotKey, payload?: string): void {
  if (!isRecord(change) || typeof change.op !== "string" || !(change.op in CHANGE_FIELDS)) {
    failures.add(`${path}.op`, `must be one of ${Object.keys(CHANGE_FIELDS).join(", ")}`);
    return;
  }
  const op = change.op as SceneChange["op"];
  const before = failures.list.length;
  checkKeys(failures, path, change, CHANGE_FIELDS[op]);
  if (failures.list.length > before) return;
  const failed = () => failures.list.length > before;

  if (op === "add-resource") {
    const at = payload ?? `${path}.resource`;
    checkResource(failures, at, change.resource);
    if (failed()) return;
    const resource = change.resource as ResourceDescriptor;
    if (staging.resource(resource.id)) failures.add(`${at}.id`, `resource ${resource.id} already exists`);
    else if (staging.removedResources.has(resource.id)) failures.add(`${at}.id`, `resource ${resource.id} is removed and added in one delta`);
    else staging.resources.set(resource.id, freezeCopy(resource));
  } else if (op === "remove-resource") {
    if (!existing(failures, `${path}.id`, change.id, staging.resource, "resource")) return;
    staging.resources.set(change.id as ResourceId, null);
    staging.removedResources.add(change.id as ResourceId);
  } else if (op === "add-layer") {
    const at = payload ?? `${path}.layer`;
    checkLayer(failures, at, change.layer);
    if (failed()) return;
    const layer = change.layer as LayerDescriptor;
    if (staging.layer(layer.id)) failures.add(`${at}.id`, `layer ${layer.id} already exists`);
    else staging.layers.set(layer.id, freezeCopy(layer));
  } else if (op === "remove-layer") {
    if (existing(failures, `${path}.id`, change.id, staging.layer, "layer")) staging.layers.set(change.id as LayerId, null);
  } else if (op === "set-layer") {
    const layer = existing(failures, `${path}.id`, change.id, staging.layer, "layer");
    if (!layer || !checkPatch(failures, `${path}.patch`, change.patch, LAYER_PATCH_FIELDS)) return;
    const merged = { ...layer, ...change.patch };
    checkLayer(failures, `${path}.patch`, merged);
    if (!failed()) staging.layers.set(layer.id, freezeCopy(merged as LayerDescriptor));
  } else if (op === "add") {
    const at = payload ?? `${path}.object`;
    checkObject(failures, at, change.object);
    if (failed()) return;
    const object = freezeCopy(change.object as SceneObject);
    if (staging.object(object.id)) return failures.add(`${at}.id`, `object ${object.id} already exists`);
    claimSlot(staging, failures, at, object, slotKey);
    track(staging, object, 1);
    staging.objects.set(object.id, object);
  } else if (op === "remove") {
    const object = existing(failures, `${path}.id`, change.id, staging.object, "object");
    if (!object) return;
    releaseSlot(staging, object, slotKey);
    track(staging, object, -1);
    staging.objects.set(object.id, null);
  } else if (op === "update") {
    const object = existing(failures, `${path}.id`, change.id, staging.object, "object");
    if (!object || !checkPatch(failures, `${path}.patch`, change.patch, PATCH_FIELDS[object.kind])) return;
    checkObject(failures, `${path}.patch`, { ...object, ...change.patch });
    if (failed()) return;
    const merged = freezeCopy({ ...object, ...change.patch } as SceneObject);
    releaseSlot(staging, object, slotKey);
    claimSlot(staging, failures, `${path}.patch`, merged, slotKey);
    track(staging, object, -1);
    track(staging, merged, 1);
    staging.objects.set(object.id, merged);
  } else if (op === "set-cells") {
    const object = existing(failures, `${path}.id`, change.id, staging.object, "object");
    if (object) stageCells(staging, failures, path, object, change.cells);
  } else {
    checkCamera(failures, `${path}.camera`, change.camera);
    if (!failed()) staging.camera = freezeCopy(change.camera as CameraState);
  }
}
