import { describe, expect, it } from "vitest";
import { SceneStore } from "../../src/core";
import { checkTexturePixels, SUPPORTED_KINDS } from "../../src/render";
import { COLOURS, referenceScene } from "../../src/demo/scenes/reference";
import { CRATE, fromRows, PALETTE, REFERENCE_TEXTURES, referenceTextures } from "../../src/demo/scenes/textures";

describe("reference scene", () => {
  it("is a valid scene of sprites only, so the WebGL2 runtime presents all of it", () => {
    const snapshot = new SceneStore(referenceScene()).snapshot();
    expect(snapshot.objects).toHaveLength(11);
    expect(snapshot.objects.every((object) => SUPPORTED_KINDS.includes(object.kind))).toBe(true);
    expect(snapshot.layers.map((layer) => layer.id)).toEqual(["backdrop", "world", "world.props", "world.figures", "hud"]);
  });

  it("provides a valid texture for every texture resource and refuses unknown ones", async () => {
    for (const resource of referenceScene().resources) {
      expect(checkTexturePixels(resource.id, await referenceTextures.texture(resource))).toBe(REFERENCE_TEXTURES[resource.id]);
    }
    await expect(referenceTextures.texture({ ...referenceScene().resources[0], id: "tex.missing" as never })).rejects.toThrow(/no texture tex\.missing/);
  });

  it("builds the pixel-art crate texel by texel, transparent texels black", () => {
    const crate = REFERENCE_TEXTURES["tex.crate"];
    expect([crate.width, crate.height, crate.filtering]).toEqual([8, 8, "nearest"]);
    const texel = (x: number, y: number) => [...crate.rgba.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
    expect(texel(0, 0)).toEqual([0, 0, 0, 0]);
    expect(texel(1, 0)).toEqual([...PALETTE.border, 255]);
    expect(texel(2, 2)).toEqual([...PALETTE.fill, 255]);
    expect(texel(6, 1)).toEqual([...PALETTE.shade, 255]);
    expect(CRATE.every((row) => row.length === 8)).toBe(true);
    expect(() => fromRows(["AB", "A"], { A: PALETTE.white, B: null })).toThrow(/row 1 is 1 wide; expected 2/);
    expect(() => fromRows(["Z"], {})).toThrow(/symbol "Z" has no colour/);
  });

  it("keeps the colours the browser tests sample", () => {
    expect(COLOURS.backdrop).toBe(0x1d2b53);
    expect(COLOURS.red).toBe(0xff004d);
  });
});
