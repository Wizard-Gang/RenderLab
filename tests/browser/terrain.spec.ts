import { expect, test } from "@playwright/test";
import { MARKER, VARIANTS } from "../../src/demo/scenes/textures";
import { markerCase, TERRAIN_CELL, VARIANT_ROW } from "../../src/demo/scenes/terrain";
import { BACKGROUND_RGB, canvasImage, misses, type Rgb } from "./reference";

// The terrain scene's chunk (0, 0) against MapLab's tile transform convention, worked out here independently of the
// renderer: undo the clockwise quarter turns, then the mirroring, to find which quadrant of the marker art should show.
const QUADRANTS: Record<string, Rgb> = { "0,0": MARKER.topLeft, "1,0": MARKER.topRight, "1,1": MARKER.bottomRight, "0,1": MARKER.bottomLeft };

function expectedQuadrant(column: number, dx: number, dy: number): Rgb {
  const cell = markerCase(column);
  let [u, v] = [0.25 + dx / 2, 0.25 + dy / 2];
  for (let turn = 0; turn < cell.quarterTurns; turn += 1) [u, v] = [v, 1 - u];
  if (cell.mirrorX) u = 1 - u;
  if (cell.mirrorY) v = 1 - v;
  return QUADRANTS[`${Number(u > 0.5)},${Number(v > 0.5)}`];
}

const half = TERRAIN_CELL / 2;
const SAMPLES = [
  ...Array.from({ length: 16 }, (_, column) => [0, 1].flatMap((dy) => [0, 1].map((dx): [string, number, number, Rgb] => [
    `marker case ${column} quadrant (${dx}, ${dy})`, column * TERRAIN_CELL + half / 2 + dx * half, half / 2 + dy * half, expectedQuadrant(column, dx, dy),
  ]))).flat(),
  ["grass variant", half, VARIANT_ROW * TERRAIN_CELL + half, VARIANTS.grass] as [string, number, number, Rgb],
  ["stone variant", TERRAIN_CELL + half, VARIANT_ROW * TERRAIN_CELL + half, VARIANTS.stone] as [string, number, number, Rgb],
  ["empty cell shows the background", 16 * TERRAIN_CELL + half, half, BACKGROUND_RGB] as [string, number, number, Rgb],
];

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`terrain chunks keep MapLab's tile placement, turns and mirroring on ${backend}`, async ({ page }) => {
    await page.goto(`/?scene=terrain&backend=${backend}`);
    const status = page.getByRole("status");
    // Both CI browsers must provide WebGL2; only WebGPU may be reported as not started, and then the test says why.
    const name = backend === "webgl2" ? "WebGL2" : "WebGPU";
    await expect(status).toHaveText(backend === "webgl2" ? /^Rendering the terrain chunks with WebGL2/ : /^(Rendering the terrain chunks with WebGPU|WebGPU (is unavailable|failed to start))/);
    const detail = (await status.textContent()) ?? "";
    test.skip(!detail.startsWith("Rendering"), `${name} did not start: ${detail}`);
    await expect(page.locator('[data-diagnostic="frames"]')).not.toHaveText("0");
    expect(misses(await canvasImage(page), SAMPLES)).toEqual([]);
    // Chunk (0, 0) is on screen and (1, 0) inside the one-chunk margin; the two far chunks are never built.
    await expect(page.locator('[data-diagnostic="chunks"]')).toHaveText(/^2 active of 4, 2 built \(budget 64\), 3 meshes$/);
    await expect(page.locator('[data-diagnostic="draw-calls"]')).not.toHaveText("unknown");
  });
}
