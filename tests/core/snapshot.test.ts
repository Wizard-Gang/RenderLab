import { describe, expect, it } from "vitest";
import {
  acceptSnapshot, checkViewport, compareObjects, ContractError, layerDrawOrder, objectId, resourceId, type PresentationSnapshot,
} from "../../src/core";
import { Failures } from "../../src/core/contracts/errors";
import { layer, sprite } from "./fixtures";

const snapshot = (): PresentationSnapshot => ({
  tick: 120,
  entities: [{
    id: objectId("hero"), position: { x: 32, y: 64 }, rotation: 0, facing: "left", visible: true,
    animation: { clip: resourceId("anim.unarmed-walk"), entryTick: 96 }, appearance: null,
  }],
  events: [{ id: "hit.1", kind: "impact", tick: 120, objectId: objectId("hero"), position: { x: 40, y: 60 }, params: { strength: 2, heavy: true } }],
});

const failuresOf = (value: unknown): readonly string[] => {
  try {
    acceptSnapshot(value);
  } catch (error) {
    if (error instanceof ContractError) return error.failures;
    throw error;
  }
  return [];
};

describe("presentation snapshots", () => {
  it("returns a frozen copy the game can no longer change", () => {
    const input = snapshot();
    const accepted = acceptSnapshot(input);
    (input.entities[0].position as { x: number }).x = 999;
    expect(accepted.entities[0].position.x).toBe(32);
    expect(Object.isFrozen(accepted.entities[0].animation)).toBe(true);
  });

  it("refuses duplicate entities, future entry ticks and unknown fields", () => {
    const input = snapshot() as unknown as { tick: number; entities: Record<string, unknown>[]; events: unknown[] };
    input.entities.push({ ...input.entities[0], animation: { clip: "anim.unarmed-walk", entryTick: 121 }, facing: "up", hp: 3 });
    input.tick = 120.5;
    expect(failuresOf(input)).toEqual([
      "snapshot.tick: must be a whole number of at least 0",
      "snapshot.entities[1].hp: is not a field of this record",
      'snapshot.entities[1].facing: must be "left" or "right"',
      "snapshot.entities[1].animation.entryTick: must not be later than the snapshot tick",
      "snapshot.entities[1].id: entity hero appears twice",
    ]);
  });

  it("bounds event parameters to plain values", () => {
    const input = snapshot() as unknown as { events: { params: Record<string, unknown> }[] };
    input.events[0].params = { ok: 1, nested: { no: true }, wide: Number.NaN };
    expect(failuresOf(input)).toEqual([
      "snapshot.events[0].params.nested: must be a finite number, a boolean or a string of at most 256 characters",
      "snapshot.events[0].params.wide: must be a finite number, a boolean or a string of at most 256 characters",
    ]);
  });
});

describe("ordering and viewports", () => {
  it("draws parents before children and siblings by order", () => {
    const order = layerDrawOrder([layer("fg", 9), layer("world.b", 2, "world"), layer("world", 1), layer("world.a", -1, "world"), layer("bg", 0)]);
    expect(order.map((entry) => entry.id)).toEqual(["bg", "world", "world.a", "world.b", "fg"]);
  });

  it("sorts objects within a layer by sortKey, then ID", () => {
    const sorted = [sprite("b", { sortKey: 1 }), sprite("c", { sortKey: 0 }), sprite("a", { sortKey: 1 })].sort(compareObjects);
    expect(sorted.map((object) => object.id)).toEqual(["c", "a", "b"]);
  });

  it("requires a positive, finite viewport", () => {
    const failures = new Failures();
    checkViewport(failures, "viewport", { width: 0, height: Number.NaN, dpr: 2 });
    expect(failures.list).toEqual(["viewport.width: must be greater than 0", "viewport.height: must be a finite number"]);
  });
});
