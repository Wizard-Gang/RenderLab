import { describe, expect, it } from "vitest";
import { ContractError, objectId, SceneStore, type SceneDefinition } from "../../src/core";
import { cell, character, chunk, definition, sprite } from "./fixtures";

function failuresOf(build: (scene: SceneDefinition) => unknown): readonly string[] {
  try {
    new SceneStore(build(definition()) as SceneDefinition);
  } catch (error) {
    if (error instanceof ContractError) return error.failures;
    throw error;
  }
  return [];
}

describe("scene definition validation", () => {
  it("accepts the reference definition", () => {
    expect(failuresOf((scene) => scene)).toEqual([]);
  });

  it("names unknown and missing fields instead of ignoring them", () => {
    expect(failuresOf((scene) => ({ ...scene, extra: true }))).toEqual(["scene.extra: is not a field of this record"]);
    const { alpha: _alpha, ...withoutAlpha } = sprite("crate.1");
    expect(failuresOf((scene) => ({ ...scene, objects: [{ ...withoutAlpha, glow: 1 }] }))).toEqual([
      "scene.objects[0].glow: is not a field of this record",
      "scene.objects[0].alpha: is required",
      "scene.objects[0].alpha: must be a finite number",
    ]);
  });

  it("refuses non-finite numbers, bad IDs, colours and ranges", () => {
    const bad = sprite("crate 1", { sortKey: Number.POSITIVE_INFINITY, tint: 0x1000000, alpha: 2, anchor: { x: Number.NaN, y: 0 } });
    expect(failuresOf((scene) => ({ ...scene, objects: [bad] }))).toEqual([
      "scene.objects[0].id: must be 1 to 512 printable ASCII characters without spaces",
      "scene.objects[0].sortKey: must be a finite number",
      "scene.objects[0].anchor.x: must be a finite number",
      "scene.objects[0].tint: must be a 0xRRGGBB colour from 0 to 16777215",
      "scene.objects[0].alpha: must be from 0 to 1",
    ]);
    expect(failuresOf((scene) => ({ ...scene, camera: { x: 0, y: 0, zoom: 0 } }))).toEqual(["scene.camera.zoom: must be greater than 0"]);
  });

  it("holds tile chunks to 1024 valid cells and static mobility", () => {
    const short = { ...chunk(0, 0), cells: [cell("grass")] };
    expect(failuresOf((scene) => ({ ...scene, objects: [short] }))).toEqual(["scene.objects[0].cells: must list exactly 1024 cells"]);
    const turned = chunk(0, 0);
    (turned.cells as unknown[])[5] = { tile: "grass", quarterTurns: 4, mirrorX: false, mirrorY: "no" };
    expect(failuresOf((scene) => ({ ...scene, objects: [{ ...turned, mobility: "dynamic" }] }))).toEqual([
      'scene.objects[0].mobility: must be "static" for a tile chunk',
      "scene.objects[0].cells[5].quarterTurns: must be 0, 1, 2 or 3",
      "scene.objects[0].cells[5].mirrorY: must be true or false",
    ]);
  });

  it("checks character animation and appearance", () => {
    const hero = character("hero", {
      animation: { clip: character("x").animation.clip, entryTick: 30, facing: "up" as never, pausedAtTick: 10 },
      presentation: "flat" as never,
    });
    expect(failuresOf((scene) => ({ ...scene, objects: [hero] }))).toEqual([
      'scene.objects[0].animation.facing: must be "left" or "right"',
      "scene.objects[0].animation.pausedAtTick: must not precede entryTick",
      'scene.objects[0].presentation: must be "articulated" or "baked"',
    ]);
  });

  it("refuses updates to identity fields and unknown patch fields", () => {
    const store = new SceneStore(definition());
    expect(() => store.apply([{ op: "update", id: objectId("hero"), patch: { kind: "sprite" } as never }])).toThrow(/delta\[0\]\.patch\.kind: cannot be changed in place/);
    expect(() => store.apply([{ op: "update", id: objectId("crate.1"), patch: { budget: 3 } as never }])).toThrow(/delta\[0\]\.patch\.budget: cannot be changed in place/);
    expect(() => store.apply([{ op: "update", id: objectId("hero"), patch: {} }])).toThrow(/must be a non-empty record of fields to change/);
    expect(() => store.apply([{ op: "teleport" } as never])).toThrow(/delta\[0\]\.op: must be one of/);
  });
});
