// Chromium and WebKit tests against the production build, served by `vite preview` on 127.0.0.1:5194 (a secure
// context, as WebGPU requires). Browsers come from `npx playwright install chromium webkit`, never from npm lifecycle
// scripts. WebKit stands in for the owner's Safari.
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL(".", import.meta.url));
export const PREVIEW_PORT = 5194;
// Headless Chromium has no WebGPU adapter by default. These flags give it SwiftShader for WebGPU (through Vulkan, which
// it needs to present to a canvas on macOS) and for WebGL2. On headless Linux the SwiftShader device still cannot
// present, with or without --disable-vulkan-surface, so CI reports WebGPU as not started (see docs/GPU-BACKENDS.md).
const CHROMIUM_GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader"];

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${PREVIEW_PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: CHROMIUM_GPU_ARGS } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js build --logLevel warn && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
    url: `http://127.0.0.1:${PREVIEW_PORT}/`,
    cwd: root,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
