import { expect, test, type Page } from "@playwright/test";
import { decodePng, pixel, type Image } from "./png";

const RUNNING = /^Rendering the reference scene with WebGL2 on PixiJS 8\.22\.0\.$/;

// Expected colours at sample points of the reference scene (src/demo/scenes/reference.ts), in CSS pixels from the
// canvas's top-left corner. Software rasterizers and colour conversion may move a channel by a few steps.
const SAMPLES: readonly [string, number, number, readonly [number, number, number]][] = [
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
  ["screen-space HUD bar", 40, 10, [255, 255, 255]],
];
const TOLERANCE = 6;

async function running(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText(RUNNING);
  await expect(page.locator('[data-diagnostic="frames"]')).not.toHaveText("0");
}

async function canvasImage(page: Page): Promise<Image> {
  return decodePng(await page.locator(".renderer-host canvas").screenshot({ scale: "css" }));
}

function expectReferencePixels(image: Image) {
  expect([image.width, image.height]).toEqual([480, 270]);
  const misses = SAMPLES.flatMap(([name, x, y, expected]) => {
    const actual = pixel(image, x, y);
    return actual.every((channel, index) => Math.abs(channel - expected[index]) <= TOLERANCE)
      ? [] : [`${name} at (${x}, ${y}): expected ${expected.join(",")}, got ${actual.join(",")}`];
  });
  expect(misses).toEqual([]);
}

test("renders the reference scene through WebGL2", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await running(page);
  await expect(page.locator('[data-diagnostic="textures"]')).toHaveText("3");
  expectReferencePixels(await canvasImage(page));
  expect(errors).toEqual([]);
});

test("reports a browser without WebGL2 instead of drawing a blank canvas", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type === "webgl2" ? null : (original as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("WebGL2 is unavailable: this browser or device did not provide a WebGL2 context");
  await expect(page.locator(".renderer-host canvas")).toHaveCount(0);
  await expect(page.locator('[data-diagnostic="state"]')).toHaveText("failed");
});

test("tears down every texture and context, then mounts again", async ({ page }) => {
  await running(page);
  await page.getByRole("button", { name: "Restart renderer" }).click();
  await expect(page.locator('[data-diagnostic="teardown"]')).toHaveText("Last teardown: destroyed, 0 textures and 0 graphics contexts held.");
  await expect(page.getByRole("status")).toHaveText(RUNNING);
  await expect(page.locator(".renderer-host canvas")).toHaveCount(1);
  await expect(page.locator('[data-diagnostic="frames"]')).not.toHaveText("0");
  expectReferencePixels(await canvasImage(page));
});

test("stops issuing draws once the WebGL2 context is lost", async ({ page }) => {
  await running(page);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".renderer-host canvas");
    canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(page.getByRole("status")).toHaveText(/^Rendering stopped: cannot render while the renderer is lost/);
  await expect(page.locator('[data-diagnostic="state"]')).toHaveText("lost");
});
