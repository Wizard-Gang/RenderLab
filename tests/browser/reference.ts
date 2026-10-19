// The reference scene's expected colours, shared by the browser suites. Points are world units, which equal CSS pixels
// from the canvas's top-left corner at the scene's own camera; `at` maps them through any other view.
import { expect, type Page } from "@playwright/test";
import { decodePng, pixel, type Image } from "./png";

export type Rgb = readonly [number, number, number];

export const SAMPLES: readonly [string, number, number, Rgb][] = [
  ["backdrop", 240, 220, [29, 43, 83]],
  ["red square", 64, 64, [255, 0, 77]],
  ["half-transparent green over the backdrop", 136, 64, [15, 136, 69]],
  ["blue square", 190, 46, [41, 173, 255]],
  ["yellow drawn over blue (higher sortKey)", 220, 76, [255, 236, 39]],
  ["split texture, left texel", 308, 56, [255, 255, 255]],
  ["split texture, right texel", 324, 56, [0, 0, 0]],
  ["mirrored split, left half", 364, 56, [0, 0, 0]],
  ["mirrored split, right half", 380, 56, [255, 255, 255]],
  ["split turned 90° clockwise, top half", 436, 48, [255, 255, 255]],
  ["split turned 90° clockwise, bottom half", 436, 64, [0, 0, 0]],
  ["crate's transparent corner shows the backdrop", 42, 142, [29, 43, 83]],
  ["crate border texel", 49, 143, [171, 82, 54]],
  ["first pixel past a texel edge stays the fill colour (nearest sampling)", 46, 155, [255, 163, 0]],
  ["glass texel at alpha 128, premultiplied exactly once", 136, 164, [142, 149, 169]],
  ["screen-space HUD bar", 40, 10, [255, 255, 255]],
];
export const BACKGROUND_RGB: Rgb = [16, 17, 20];
export const TOLERANCE = 6;

export async function canvasImage(page: Page, scale: "css" | "device" = "css"): Promise<Image> {
  return decodePng(await page.locator(".renderer-host canvas").screenshot({ scale }));
}

/** Every sample whose colour is off by more than the tolerance, described; `place` maps a world point to the image. */
export function misses(image: Image, samples: readonly [string, number, number, Rgb][], place = (x: number, y: number) => ({ x, y })): string[] {
  return samples.flatMap(([name, worldX, worldY, expected]) => {
    const { x, y } = place(worldX, worldY);
    const actual = pixel(image, x, y);
    return actual.every((channel, index) => Math.abs(channel - expected[index]) <= TOLERANCE)
      ? [] : [`${name} at (${Math.floor(x)}, ${Math.floor(y)}): expected ${expected.join(",")}, got ${actual.join(",")}`];
  });
}

export async function expectReferencePixels(page: Page) {
  const image = await canvasImage(page);
  expect([image.width, image.height]).toEqual([480, 270]);
  expect(misses(image, SAMPLES)).toEqual([]);
}
