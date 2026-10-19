import { describe, expect, it } from "vitest";
import { SceneStore } from "../../src/core";
import { checkTexturePixels } from "../../src/render";
import { GRID_CAMERA, gridScene } from "../../src/demo/scenes/grid";
import { REFERENCE_TEXTURES } from "../../src/demo/scenes/textures";
import { optionsFromLocation, pixelPolicy, viewSize } from "../../src/demo/ui/options";

describe("demo options", () => {
  it("reads every choice from the URL and falls back on unknown values", () => {
    expect(optionsFromLocation("?backend=webgpu&prefer=webgpu&scene=grid&pixel=strict&view=640x360")).toEqual({
      backend: "webgpu", preference: "webgpu", scene: "grid", pixel: "strict", view: "640x360",
    });
    expect(optionsFromLocation("?backend=opengl&scene=moon&pixel=crisp&view=1x1")).toEqual({
      backend: "auto", preference: "webgl2", scene: "reference", pixel: "smooth", view: "480x270",
    });
  });

  it("maps sizes and pixel policies", () => {
    expect(viewSize("320x180")).toEqual({ width: 320, height: 180 });
    expect(pixelPolicy("strict")).toEqual({ mode: "strict-pixel" });
    expect(pixelPolicy("smooth")).toEqual({ mode: "smooth", snap: true });
  });
});

describe("pixel-grid scene", () => {
  it("is a valid scene whose checker texel is one world unit", () => {
    const snapshot = new SceneStore(gridScene()).snapshot();
    expect(snapshot.camera).toEqual(GRID_CAMERA);
    const checker = checkTexturePixels("tex.checker", REFERENCE_TEXTURES["tex.checker"]);
    expect([checker.width, checker.height]).toEqual([16, 16]);
    const texel = (x: number, y: number) => [...checker.rgba.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 3)];
    expect([texel(0, 0), texel(1, 0), texel(1, 1), texel(15, 14)]).toEqual([[0, 0, 0], [255, 255, 255], [0, 0, 0], [255, 255, 255]]);
  });
});
