import { expect, test, type Page } from "@playwright/test";
import { computeView, panBy, SMOOTH_SNAPPED, STRICT_PIXEL, worldToScreen, zoomAt, type Viewport } from "../../src/core";
import { GRID_CAMERA } from "../../src/demo/scenes/grid";
import { referenceScene } from "../../src/demo/scenes/reference";
import { pixel } from "./png";
import { BACKGROUND_RGB, canvasImage, misses, SAMPLES, TOLERANCE } from "./reference";

const status = (page: Page) => page.getByRole("status");

async function open(page: Page, query: string, label: RegExp) {
  await page.goto(`/${query}`);
  await expect(status(page)).toHaveText(label);
  await expect(page.locator('[data-diagnostic="frames"]')).not.toHaveText("0");
}

const near = (actual: readonly number[], expected: readonly number[]) => actual.every((value, index) => Math.abs(value - expected[index]) <= TOLERANCE);

for (const dpr of [1, 2]) {
  test.describe(`at device pixel ratio ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("strict pixels draw every checker texel as an equal square of whole device pixels", async ({ page }) => {
      await open(page, "?scene=grid&pixel=strict&backend=webgl2", /^Rendering the pixel grid with WebGL2/);
      const view = computeView(GRID_CAMERA, { width: 480, height: 270, dpr }, STRICT_PIXEL);
      expect(view.deviceScale).toBe(dpr === 1 ? 3 : 5);
      const image = await canvasImage(page, "device");
      expect([image.width, image.height]).toEqual([480 * dpr, 270 * dpr]);
      const wrong: string[] = [];
      for (const row of [0, 7, 15]) {
        for (let column = 0; column < 16; column += 1) {
          const left = Math.round((view.originX + column * view.zoom) * dpr);
          const top = Math.round((view.originY + row * view.zoom) * dpr);
          const expected = (column + row) % 2 ? [255, 255, 255] : [0, 0, 0];
          for (let dy = 0; dy < view.deviceScale; dy += 1) {
            for (let dx = 0; dx < view.deviceScale; dx += 1) {
              const actual = pixel(image, left + dx, top + dy);
              if (!near(actual, expected)) wrong.push(`texel (${column}, ${row}) device pixel (${left + dx}, ${top + dy}): ${actual.join(",")}`);
            }
          }
        }
      }
      expect(wrong.slice(0, 5)).toEqual([]);
      const edge = Math.round((view.originX + 16 * view.zoom) * dpr);
      expect(near(pixel(image, edge, Math.round((view.originY + 8.5 * view.zoom) * dpr)), BACKGROUND_RGB)).toBe(true);
    });
  });
}

test.describe("at device pixel ratio 1", () => {
  test.use({ deviceScaleFactor: 1 });

  test("smooth zoom at the same scale draws uneven texel widths, which strict pixels prevent", async ({ page }) => {
    await open(page, "?scene=grid&pixel=smooth&backend=webgl2", /^Rendering the pixel grid with WebGL2/);
    const view = computeView(GRID_CAMERA, { width: 480, height: 270, dpr: 1 }, SMOOTH_SNAPPED);
    const image = await canvasImage(page, "device");
    const y = Math.floor(view.originY + 8.5 * view.zoom);
    const runs: number[] = [];
    let length = 0;
    let previous = "";
    for (let x = Math.ceil(view.originX); x < Math.floor(view.originX + 16 * view.zoom); x += 1) {
      const colour = pixel(image, x, y).join(",");
      if (colour === previous) length += 1;
      else {
        if (previous) runs.push(length);
        previous = colour;
        length = 1;
      }
    }
    expect(new Set(runs.slice(1)).size).toBeGreaterThan(1);
  });

  test("resizing the view keeps the scene centred inside its bounds", async ({ page }) => {
    await open(page, "?backend=webgl2", /^Rendering the reference scene with WebGL2/);
    await page.getByRole("combobox", { name: /^View/ }).selectOption("640x360");
    await expect(page.locator(".renderer-host canvas")).toHaveJSProperty("clientWidth", 640);
    await expect(page.locator('[data-diagnostic="center"]')).toHaveText("240, 135");
    const image = await canvasImage(page);
    expect([image.width, image.height]).toEqual([640, 360]);
    // World layers centre on the bounds (80, 45 px in); the screen-space HUD keeps its CSS position.
    const hud = ([name]: readonly [string, ...unknown[]]) => name.startsWith("screen-space");
    expect(misses(image, SAMPLES.filter((sample) => !hud(sample)), (x, y) => ({ x: x + 80, y: y + 45 }))).toEqual([]);
    expect(misses(image, SAMPLES.filter(hud))).toEqual([]);
    expect(near(pixel(image, 5, 30), BACKGROUND_RGB)).toBe(true);
  });

  test("keyboard zoom and pan move the camera, and the GPU output follows the core camera math", async ({ page }) => {
    await open(page, "?backend=webgl2", /^Rendering the reference scene with WebGL2/);
    const viewport: Viewport = { width: 480, height: 270, dpr: 1 };
    let camera = referenceScene().camera;
    await page.locator(".renderer-host").focus();
    for (const key of ["+", "+", "ArrowLeft"]) {
      await page.keyboard.press(key);
      camera = key === "ArrowLeft"
        ? panBy(camera, { x: 24, y: 0 }, viewport, SMOOTH_SNAPPED)
        : zoomAt(camera, viewport, { x: 240, y: 135 }, 1.25, undefined, SMOOTH_SNAPPED);
    }
    const view = computeView(camera, viewport, SMOOTH_SNAPPED);
    await expect(page.locator('[data-diagnostic="zoom"]')).toHaveText("1.563 CSS px per world unit, 1.563 device px");
    await expect(page.locator('[data-diagnostic="center"]')).toHaveText(`${Math.round(view.centerX * 1000) / 1000}, 135`);
    await expect.poll(async () => {
      const image = await canvasImage(page);
      return misses(image, SAMPLES.filter(([name]) => name.startsWith("yellow") || name.startsWith("glass")), (x, y) => worldToScreen(view, { x, y }));
    }).toEqual([]);
  });
});
