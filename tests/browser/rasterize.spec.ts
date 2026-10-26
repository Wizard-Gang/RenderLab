import { expect, test, type Page } from "@playwright/test";
import { prepareSvg, rasterizeSvgInBrowser, type PreparedSvg } from "../../src/assets";

// The browser rasterizer in Chromium and WebKit, against expectations computed here rather than against each other:
// pixel art on whole pixels must come back exact in both, and antialiased edges within the tolerance that
// docs/ASSET-PIPELINE.md documents (total coverage within 2% of the analytic area, partial pixels only at the edge).

const PALETTE: Record<string, readonly [number, number, number]> = {
  R: [255, 0, 77], Y: [255, 236, 39], B: [41, 173, 255], K: [0, 0, 0], W: [255, 255, 255],
};
const ART = [
  "..RRRR..",
  ".RYYYYR.",
  "RYKYYKYR",
  "RYYYYYYR",
  "RYBYYBYR",
  "RYYBBYYR",
  ".RYYYYR.",
  "..RRRRW.",
];
const SCALE = 2;
const COVERAGE_TOLERANCE = 0.02;

const hex = (rgb: readonly number[]) => `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
const pixelArt = () => {
  const rects = ART.flatMap((row, y) => [...row].flatMap((cell, x) =>
    cell === "." ? [] : [`<rect x="${x}" y="${y}" width="1" height="1" fill="${hex(PALETTE[cell])}"/>`]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges">${rects.join("")}</svg>`;
};

async function rasterize(page: Page, prepared: PreparedSvg): Promise<number[]> {
  const request = { svg: prepared.svg, width: prepared.width, height: prepared.height };
  // The production function itself, evaluated in the page; it has no imports, so its source stands alone.
  return page.evaluate(`(${rasterizeSvgInBrowser.toString()})(${JSON.stringify(request)}).then((data) => Array.from(data))`);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("pixel art at a whole-number scale rasterizes to exact pixels", async ({ page }) => {
  const prepared = prepareSvg(pixelArt(), SCALE, "face");
  expect([prepared.width, prepared.height]).toEqual([16, 16]);
  const data = await rasterize(page, prepared);
  expect(data).toHaveLength(16 * 16 * 4);
  const wrong: string[] = [];
  for (let y = 0; y < prepared.height; y += 1) {
    for (let x = 0; x < prepared.width; x += 1) {
      const cell = ART[Math.floor(y / SCALE)][Math.floor(x / SCALE)];
      const expected = cell === "." ? [0, 0, 0, 0] : [...PALETTE[cell], 255];
      const actual = data.slice((y * prepared.width + x) * 4, (y * prepared.width + x) * 4 + 4);
      if (actual.join() !== expected.join()) wrong.push(`(${x}, ${y}): ${actual.join(",")} not ${expected.join(",")}`);
    }
  }
  expect(wrong.slice(0, 8)).toEqual([]);
});

test("the same source rasterizes to the same bytes every time", async ({ page }) => {
  for (const source of [pixelArt(), '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="5" fill="#29adff"/></svg>']) {
    const prepared = prepareSvg(source, 3, "repeat");
    const first = await rasterize(page, prepared);
    for (let run = 0; run < 3; run += 1) expect(await rasterize(page, prepared)).toEqual(first);
  }
});

test("antialiased edges stay within the documented coverage tolerance", async ({ page }) => {
  const radius = 6 * SCALE;
  const prepared = prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="#ffffff"/></svg>', SCALE, "disc");
  const data = await rasterize(page, prepared);
  const centre = prepared.width / 2;
  let coverage = 0;
  let partial = 0;
  const strays: string[] = [];
  for (let y = 0; y < prepared.height; y += 1) {
    for (let x = 0; x < prepared.width; x += 1) {
      const alpha = data[(y * prepared.width + x) * 4 + 3];
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      coverage += alpha / 255;
      if (alpha > 0 && alpha < 255) {
        partial += 1;
        if (Math.abs(distance - radius) > 1.5) strays.push(`(${x}, ${y}) alpha ${alpha} at distance ${distance.toFixed(2)}`);
      } else if ((alpha === 255) !== (distance < radius)) {
        strays.push(`(${x}, ${y}) alpha ${alpha} at distance ${distance.toFixed(2)}`);
      }
    }
  }
  const area = Math.PI * radius * radius;
  expect(Math.abs(coverage - area) / area).toBeLessThanOrEqual(COVERAGE_TOLERANCE);
  expect(partial).toBeGreaterThan(0);
  expect(strays.slice(0, 8)).toEqual([]);
  expect(data.slice((centre * prepared.width + centre) * 4, (centre * prepared.width + centre) * 4 + 4)).toEqual([255, 255, 255, 255]);
});
