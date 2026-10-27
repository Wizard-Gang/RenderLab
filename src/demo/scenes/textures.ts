// Textures generated in code for the reference scene, until RLDR-006/RLDR-007 compile real artwork. Pixels are straight
// RGBA8; the runtime premultiplies them, and the glass texel's partial alpha shows both backends do it the same way.
import type { ResourceDescriptor } from "../../core";
import type { TexturePixels, TextureProvider, TilesetAtlas } from "../../render";

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
  // One white texel at alpha 128 of 255.
  "tex.glass": { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 128]), filtering: "nearest" },
  // A 16×16 checkerboard, black where column + row is even: one texel per world unit in the grid scene.
  "tex.checker": fromRows(
    Array.from({ length: 16 }, (_, row) => Array.from({ length: 16 }, (_, column) => ((column + row) % 2 ? "W" : "K")).join("")),
    { W: PALETTE.white, K: PALETTE.black },
  ),
});

/** Colours of the marker tile's quadrants, which show every turn and mirror at a glance. */
export const MARKER = Object.freeze({
  topLeft: [255, 0, 77] as Rgb,
  topRight: [255, 236, 39] as Rgb,
  bottomRight: [41, 173, 255] as Rgb,
  bottomLeft: [255, 255, 255] as Rgb,
});
export const VARIANTS = Object.freeze({ grass: [0, 135, 81] as Rgb, stone: [131, 118, 156] as Rgb });

/**
 * The terrain scene's tileset as a compiled two-page atlas: the 4×4 marker tile alone on page 0, and two one-texel
 * variant tiles side by side on page 1, so a chunk using both submits one mesh per page.
 */
export const REFERENCE_TILESETS: Readonly<Record<string, TilesetAtlas>> = Object.freeze({
  "tileset.marker": {
    pages: [
      fromRows(["RRYY", "RRYY", "WWBB", "WWBB"], { R: MARKER.topLeft, Y: MARKER.topRight, B: MARKER.bottomRight, W: MARKER.bottomLeft }),
      fromRows(["GS"], { G: VARIANTS.grass, S: VARIANTS.stone }),
    ],
    regions: [
      { id: "tile.grass", page: 1, u0: 0, v0: 0, u1: 0.5, v1: 1 },
      { id: "tile.marker", page: 0, u0: 0, v0: 0, u1: 1, v1: 1 },
      { id: "tile.stone", page: 1, u0: 0.5, v0: 0, u1: 1, v1: 1 },
    ],
  },
});

export const referenceTextures: TextureProvider = {
  async tileset(resource: ResourceDescriptor): Promise<TilesetAtlas> {
    const tileset = REFERENCE_TILESETS[resource.id];
    if (!tileset) throw new Error(`the demo scenes have no tileset ${resource.id}`);
    return tileset;
  },
  async texture(resource: ResourceDescriptor): Promise<TexturePixels> {
    const pixels = REFERENCE_TEXTURES[resource.id];
    if (!pixels) throw new Error(`the reference scene has no texture ${resource.id}`);
    return pixels;
  },
};
