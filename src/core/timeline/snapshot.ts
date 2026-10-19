// The presentation snapshot a consuming game hands RenderLab each fixed tick (specification §14). It is read-only
// input: the renderer never writes back into simulation state, so snapshots are validated, copied and frozen.
import { ContractError, Failures } from "../contracts/errors";
import { checkId, type ObjectId, type ResourceId } from "../contracts/ids";
import { checkBoolean, checkFinite, checkInteger, checkVec2, isRecord, type Vec2 } from "../contracts/values";
import { freezeCopy } from "../scene/data";
import { checkKeys } from "../scene/validate";
import { checkFacing, type Facing } from "./animation";

export interface EntityPresentation {
  readonly id: ObjectId;
  readonly position: Vec2;
  /** Degrees, positive clockwise on screen. */
  readonly rotation: number;
  readonly facing: Facing;
  readonly visible: boolean;
  readonly animation: { readonly clip: ResourceId; readonly entryTick: number };
  readonly appearance: { readonly skin: ResourceId | null; readonly palette: ResourceId | null; readonly equipment: readonly ResourceId[] } | null;
}

export type EventParam = number | string | boolean;

/** A non-authoritative cue for presentation, such as an impact to draw at a point. */
export interface PresentationEvent {
  readonly id: string;
  readonly kind: string;
  readonly tick: number;
  readonly objectId: ObjectId | null;
  readonly position: Vec2 | null;
  readonly params: Readonly<Record<string, EventParam>>;
}

export interface PresentationSnapshot {
  /** The authoritative simulation tick this state belongs to. */
  readonly tick: number;
  readonly entities: readonly EntityPresentation[];
  readonly events: readonly PresentationEvent[];
}

function checkEntity(failures: Failures, path: string, value: unknown, tick: unknown): void {
  if (!isRecord(value)) return failures.add(path, "must be an entity presentation");
  checkKeys(failures, path, value, ["id", "position", "rotation", "facing", "visible", "animation", "appearance"]);
  checkId(failures, `${path}.id`, value.id);
  checkVec2(failures, `${path}.position`, value.position);
  checkFinite(failures, `${path}.rotation`, value.rotation);
  checkFacing(failures, `${path}.facing`, value.facing);
  checkBoolean(failures, `${path}.visible`, value.visible);
  if (!isRecord(value.animation)) failures.add(`${path}.animation`, "must be an animation { clip, entryTick }");
  else {
    checkKeys(failures, `${path}.animation`, value.animation, ["clip", "entryTick"]);
    checkId(failures, `${path}.animation.clip`, value.animation.clip);
    checkInteger(failures, `${path}.animation.entryTick`, value.animation.entryTick, 0);
    if (typeof tick === "number" && (value.animation.entryTick as number) > tick) failures.add(`${path}.animation.entryTick`, "must not be later than the snapshot tick");
  }
  if (value.appearance === null) return;
  if (!isRecord(value.appearance)) return failures.add(`${path}.appearance`, "must be null or an appearance { skin, palette, equipment }");
  checkKeys(failures, `${path}.appearance`, value.appearance, ["skin", "palette", "equipment"]);
  for (const field of ["skin", "palette"] as const) {
    if (value.appearance[field] !== null) checkId(failures, `${path}.appearance.${field}`, value.appearance[field]);
  }
  const equipment = value.appearance.equipment;
  if (!Array.isArray(equipment) || equipment.length > 64) failures.add(`${path}.appearance.equipment`, "must be a list of at most 64 IDs");
  else equipment.forEach((id, index) => checkId(failures, `${path}.appearance.equipment[${index}]`, id));
}

function checkEvent(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) return failures.add(path, "must be a presentation event");
  checkKeys(failures, path, value, ["id", "kind", "tick", "objectId", "position", "params"]);
  checkId(failures, `${path}.id`, value.id);
  checkId(failures, `${path}.kind`, value.kind);
  checkInteger(failures, `${path}.tick`, value.tick, 0);
  if (value.objectId !== null) checkId(failures, `${path}.objectId`, value.objectId);
  if (value.position !== null) checkVec2(failures, `${path}.position`, value.position);
  if (!isRecord(value.params) || Object.keys(value.params).length > 64) return failures.add(`${path}.params`, "must be a record of at most 64 values");
  for (const [name, param] of Object.entries(value.params)) {
    const ok = typeof param === "boolean" || (typeof param === "string" && param.length <= 256) || (typeof param === "number" && Number.isFinite(param));
    if (!ok) failures.add(`${path}.params.${name}`, "must be a finite number, a boolean or a string of at most 256 characters");
  }
}

/** Validate a snapshot and return a frozen copy the renderer can keep without the game ever seeing a change. */
export function acceptSnapshot(value: unknown): PresentationSnapshot {
  const failures = new Failures();
  if (!isRecord(value)) throw new ContractError("presentation snapshot", ["snapshot: must be a presentation snapshot"]);
  checkKeys(failures, "snapshot", value, ["tick", "entities", "events"]);
  checkInteger(failures, "snapshot.tick", value.tick, 0);
  const ids = new Set<unknown>();
  if (!Array.isArray(value.entities)) failures.add("snapshot.entities", "must be a list");
  else value.entities.forEach((entity: unknown, index) => {
    checkEntity(failures, `snapshot.entities[${index}]`, entity, value.tick);
    const id = isRecord(entity) ? entity.id : undefined;
    if (ids.has(id)) failures.add(`snapshot.entities[${index}].id`, `entity ${String(id)} appears twice`);
    ids.add(id);
  });
  const eventIds = new Set<unknown>();
  if (!Array.isArray(value.events)) failures.add("snapshot.events", "must be a list");
  else value.events.forEach((event: unknown, index) => {
    checkEvent(failures, `snapshot.events[${index}]`, event);
    const id = isRecord(event) ? event.id : undefined;
    if (eventIds.has(id)) failures.add(`snapshot.events[${index}].id`, `event ${String(id)} appears twice`);
    eventIds.add(id);
  });
  failures.throwIfAny("presentation snapshot");
  return freezeCopy(value as unknown as PresentationSnapshot);
}
