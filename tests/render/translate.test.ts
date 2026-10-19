import { describe, expect, it } from "vitest";
import { checkTexturePixels, MAX_TEXTURE_EDGE, premultiplied } from "../../src/render";
import { drawRanks, layerDisplay, spriteDisplay, toRadians } from "../../src/render/pixi/translate";
import { layer, sprite } from "../core/fixtures";

describe("model to display translation", () => {
  it("turns degrees into radians and folds mirroring into the scale sign", () => {
    const display = spriteDisplay(sprite("s", {
      transform: { x: 10, y: -4, rotation: 90, scaleX: 2, scaleY: 3, mirrorX: true, mirrorY: false }, anchor: { x: 0.5, y: 1 }, tint: 0x123456, alpha: 0.25,
    }));
    expect(display).toEqual({ x: 10, y: -4, rotation: Math.PI / 2, scaleX: -2, scaleY: 3, anchorX: 0.5, anchorY: 1, tint: 0x123456, alpha: 0.25, visible: true });
    expect(spriteDisplay(sprite("t", { transform: { ...sprite("t").transform, mirrorY: true } })).scaleY).toBe(-1);
    expect(toRadians(-180)).toBe(-Math.PI);
  });

  it("ranks objects within a layer by sortKey, then ID", () => {
    const ranks = drawRanks([sprite("b", { sortKey: 2 }), sprite("a", { sortKey: 2 }), sprite("z", { sortKey: -1 })]);
    expect([...ranks]).toEqual([["z", 0], ["a", 1], ["b", 2]]);
  });

  it("maps layer visibility and opacity", () => {
    expect(layerDisplay(layer("l", 0, null, { visible: false, opacity: 0.5 }))).toEqual({ visible: false, alpha: 0.5 });
  });
});

describe("texture pixels", () => {
  const pixels = (width: number, height: number, bytes = width * height * 4) => ({
    width, height, rgba: new Uint8Array(bytes), filtering: "nearest" as const,
  });

  it("accepts RGBA8 data that matches its size", () => {
    expect(checkTexturePixels("tex", pixels(2, 3)).width).toBe(2);
  });

  it("names every problem with sizes, data and filtering", () => {
    expect(() => checkTexturePixels("tex.bad", pixels(0, MAX_TEXTURE_EDGE + 1))).toThrow(
      /texture tex\.bad is invalid:\n- width: must be a whole number from 1 to 2048\n- height: must be a whole number from 1 to 2048/,
    );
    expect(() => checkTexturePixels("tex.short", pixels(2, 2, 15))).toThrow(/rgba: must hold width \* height \* 4 = 16 bytes, not 15/);
    expect(() => checkTexturePixels("tex.blur", { ...pixels(1, 1), filtering: "bilinear" as never })).toThrow(/filtering: must be "nearest" or "linear"/);
  });
});

describe("premultiplied alpha", () => {
  it("multiplies colour by alpha once, rounding to nearest, and keeps alpha", () => {
    const input = new Uint8Array([255, 255, 255, 128, 10, 20, 30, 0, 200, 100, 50, 255, 127, 255, 1, 128]);
    expect([...premultiplied(input)]).toEqual([128, 128, 128, 128, 0, 0, 0, 0, 200, 100, 50, 255, 64, 128, 1, 128]);
    expect([...input.subarray(0, 4)]).toEqual([255, 255, 255, 128]);
  });

  it("refuses textures over a device's probed limit", () => {
    expect(() => checkTexturePixels("tex.big", { width: 4096, height: 1, rgba: new Uint8Array(4096 * 4), filtering: "linear" }, 2048))
      .toThrow(/width: must be a whole number from 1 to 2048/);
    expect(checkTexturePixels("tex.big", { width: 4096, height: 1, rgba: new Uint8Array(4096 * 4), filtering: "linear" }, 8192).width).toBe(4096);
  });
});
