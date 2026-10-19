// Textures generated in code for the reference scene, until RLDR-006/RLDR-007 compile real artwork. Pixels are opaque
// or fully transparent (transparent ones are black), so premultiplied and straight alpha draw identically.
import type { ResourceDescriptor } from "../../core";
import type { TexturePixels, TextureProvider } from "../../render";

type Rgb = readonly [number, number, number];

export const PALETTE = Object.freeze({
  white: [255, 255, 255] as Rgb,
  black: [0, 0, 0] as Rgb,
  border: [171, 82, 54] as Rgb,
  fill: [255, 163, 0] as Rgb,
  shade: [126, 37, 83] as Rgb,
});

/** An 8×8 pixel-art crate: `.` transparent, `B` border, `O` fill, `D` diagonal shade. */
export const CRATE = Object.freeze([
  ".BBBBBB.",
  "BOOOOODB",
  "BOOOODOB",
  "BOOODOOB",
  "BOODOOOB",
  "BODOOOOB",
  "BDOOOOOB",
  ".BBBBBB.",
]);

export function fromRows(rows: readonly string[], key: Readonly<Record<string, Rgb | null>>): TexturePixels {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const rgba = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`texture row ${y} is ${row.length} wide; expected ${width}`);
    [...row].forEach((symbol, x) => {
      if (!(symbol in key)) throw new Error(`texture symbol ${JSON.stringify(symbol)} has no colour`);
      const colour = key[symbol];
      if (colour) rgba.set([...colour, 255], (y * width + x) * 4);
    });
  });
  return { width, height, rgba, filtering: "nearest" };
}

export const REFERENCE_TEXTURES: Readonly<Record<string, TexturePixels>> = Object.freeze({
  // One white texel, tinted per sprite.
  "tex.white": fromRows(["W"], { W: PALETTE.white }),
  // Left texel white, right texel black: shows mirroring and rotation.
  "tex.split": fromRows(["WK"], { W: PALETTE.white, K: PALETTE.black }),
  "tex.crate": fromRows(CRATE, { ".": null, B: PALETTE.border, O: PALETTE.fill, D: PALETTE.shade }),
});

export const referenceTextures: TextureProvider = {
  async texture(resource: ResourceDescriptor): Promise<TexturePixels> {
    const pixels = REFERENCE_TEXTURES[resource.id];
    if (!pixels) throw new Error(`the reference scene has no texture ${resource.id}`);
    return pixels;
  },
};
