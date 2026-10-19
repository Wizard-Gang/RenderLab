import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { expectReferencePixels } from "./reference";

type Backend = "webgl2" | "webgpu";
const NAMES: Record<Backend, string> = { webgl2: "WebGL2", webgpu: "WebGPU" };
const running = (backend: Backend) => new RegExp(`^Rendering the reference scene with ${NAMES[backend]} on PixiJS 8\\.22\\.0\\.$`);

const FORCE_DEVICE_FAILURE = () => {
  if (typeof GPUAdapter !== "undefined") GPUAdapter.prototype.requestDevice = () => Promise.reject(new Error("forced by the test"));
};
const WITHOUT_WEBGL2 = () => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    return type === "webgl2" ? null : (original as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
  } as typeof original;
};

const status = (page: Page) => page.getByRole("status");
const diagnostic = (page: Page, name: string) => page.locator(`[data-diagnostic="${name}"]`);

async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(status(page)).not.toHaveText("Starting the renderer…");
  await expect(page.locator('[data-capability="webgpu"]')).toHaveText(/\S/);
}

/** What the probe found for WebGPU. Every run reports it, so a missing backend is never silent. */
async function webgpu(page: Page, info: TestInfo): Promise<{ available: boolean; detail: string }> {
  const detail = (await page.locator('[data-capability="webgpu"]').textContent()) ?? "";
  info.annotations.push({ type: "webgpu", description: detail });
  console.log(`[${info.project.name}] WebGPU ${detail}`);
  return { available: detail.startsWith("available"), detail };
}

/**
 * Whether the page is rendering on `backend`, or the exact reason it is not. An adapter can exist and still fail to
 * start (headless Linux Chromium's SwiftShader device cannot present), so tests key off the outcome, not the probe.
 */
async function started(page: Page, info: TestInfo, backend: Backend): Promise<{ running: boolean; detail: string }> {
  const detail = (await status(page).textContent()) ?? "";
  const isRunning = running(backend).test(detail);
  if (!isRunning) {
    info.annotations.push({ type: `${backend}-not-started`, description: detail });
    console.log(`[${info.project.name}] ${NAMES[backend]} did not start: ${detail}`);
  }
  return { running: isRunning, detail };
}

async function rendering(page: Page, backend: Backend) {
  await expect(status(page)).toHaveText(running(backend));
  await expect(diagnostic(page, "active")).toHaveText(backend);
  await expect(diagnostic(page, "frames")).not.toHaveText("0");
}

test("auto prefers WebGL2 and renders the reference scene", async ({ page }) => {
  await open(page);
  await rendering(page, "webgl2");
  await expect(diagnostic(page, "attempts")).toHaveText("webgl2: selected");
  await expect(diagnostic(page, "textures")).toHaveText("4");
  await expectReferencePixels(page);
});

test("explicit WebGL2 renders the reference scene", async ({ page }) => {
  await open(page, "?backend=webgl2");
  await rendering(page, "webgl2");
  await expectReferencePixels(page);
});

test("explicit WebGPU renders the reference scene, or says exactly why it cannot", async ({ page }, info) => {
  await open(page, "?backend=webgpu");
  const { available } = await webgpu(page, info);
  if ((await started(page, info, "webgpu")).running) {
    await rendering(page, "webgpu");
    await expectReferencePixels(page);
  } else {
    await expect(status(page)).toHaveText(available ? /^WebGPU failed to start: \S/ : /^WebGPU is unavailable: \S/);
    await expect(diagnostic(page, "active")).toHaveText("none");
    await expect(diagnostic(page, "state")).toHaveText("failed");
    await expect(page.locator(".renderer-host canvas")).toHaveCount(0);
  }
});

test("a WebGPU failure under auto preferring WebGPU falls back to WebGL2 and records why", async ({ page }, info) => {
  await page.addInitScript(FORCE_DEVICE_FAILURE);
  await open(page, "?backend=auto&prefer=webgpu");
  const { available } = await webgpu(page, info);
  await rendering(page, "webgl2");
  await expect(diagnostic(page, "attempts")).toHaveText(available
    ? "webgpu: failed (requesting a device failed: forced by the test); webgl2: selected"
    : /^webgpu: unavailable \(.+\); webgl2: selected$/);
  await expectReferencePixels(page);
});

test("the same failure under explicit WebGPU stays failed instead of downgrading", async ({ page }, info) => {
  await page.addInitScript(FORCE_DEVICE_FAILURE);
  await open(page, "?backend=webgpu");
  const { available } = await webgpu(page, info);
  await expect(status(page)).toHaveText(available ? "WebGPU failed to start: requesting a device failed: forced by the test" : /^WebGPU is unavailable: \S/);
  await expect(diagnostic(page, "state")).toHaveText("failed");
  await expect(page.locator(".renderer-host canvas")).toHaveCount(0);
});

test("explicit WebGL2 reports a browser without WebGL2 instead of drawing a blank canvas", async ({ page }) => {
  await page.addInitScript(WITHOUT_WEBGL2);
  await open(page, "?backend=webgl2");
  await expect(status(page)).toHaveText("WebGL2 is unavailable: this browser or device did not provide a WebGL2 context");
  await expect(page.locator('[data-capability="webgl2"]')).toHaveText("unavailable: this browser or device did not provide a WebGL2 context");
  await expect(diagnostic(page, "state")).toHaveText("failed");
  await expect(page.locator(".renderer-host canvas")).toHaveCount(0);
});

test("auto without WebGL2 starts WebGPU where it can, or names both failures", async ({ page }, info) => {
  await page.addInitScript(WITHOUT_WEBGL2);
  await open(page);
  await webgpu(page, info);
  if ((await started(page, info, "webgpu")).running) {
    await rendering(page, "webgpu");
    await expectReferencePixels(page);
  } else {
    await expect(status(page)).toHaveText(/^no permitted graphics backend could start\. WebGL2 is unavailable: .+; WebGPU (is unavailable|failed to start): \S/);
  }
});

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`${NAMES[backend]} tears down every texture and context, then mounts again`, async ({ page }, info) => {
    await open(page, `?backend=${backend}`);
    if (backend === "webgpu") {
      await webgpu(page, info);
      const { running: isRunning, detail } = await started(page, info, "webgpu");
      test.skip(!isRunning, `WebGPU did not start: ${detail}`);
    }
    await rendering(page, backend);
    await page.getByRole("button", { name: "Restart renderer" }).click();
    await expect(diagnostic(page, "teardown")).toHaveText("Last teardown: destroyed, 0 textures and 0 graphics contexts held.");
    await rendering(page, backend);
    await expect(page.locator(".renderer-host canvas")).toHaveCount(1);
    await expectReferencePixels(page);
  });
}

test("WebGL2 stops issuing draws once its context is lost", async ({ page }) => {
  await open(page, "?backend=webgl2");
  await rendering(page, "webgl2");
  await page.evaluate(() => {
    document.querySelector<HTMLCanvasElement>(".renderer-host canvas")?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(status(page)).toHaveText(/^Rendering stopped: cannot render while the renderer is lost/);
  await expect(diagnostic(page, "state")).toHaveText("lost");
});

test("WebGPU stops issuing draws once its device is lost", async ({ page }, info) => {
  await page.addInitScript(() => {
    if (typeof GPUAdapter === "undefined") return;
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, ...args: Parameters<typeof request>) {
      const device = await request.apply(this, args);
      let lose: (info: { reason: string; message: string }) => void = () => {};
      Object.defineProperty(device, "lost", { value: new Promise((resolve) => { lose = resolve; }), configurable: true });
      (window as unknown as { loseDevice: () => void }).loseDevice = () => lose({ reason: "unknown", message: "forced by the test" });
      return device;
    };
  });
  await open(page, "?backend=webgpu");
  await webgpu(page, info);
  const { running: isRunning, detail } = await started(page, info, "webgpu");
  test.skip(!isRunning, `WebGPU did not start: ${detail}`);
  await rendering(page, "webgpu");
  await page.evaluate(() => (window as unknown as { loseDevice: () => void }).loseDevice());
  await expect(status(page)).toHaveText(/^Rendering stopped: cannot render while the renderer is lost/);
  await expect(diagnostic(page, "state")).toHaveText("lost");
});
