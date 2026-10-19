// Chromium and WebKit tests against the production build, served by `vite preview` on 127.0.0.1:5194. Browsers come
// from `npx playwright install chromium webkit`, never from npm lifecycle scripts. WebKit stands in for the owner's
// Safari.
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL(".", import.meta.url));
export const PREVIEW_PORT = 5194;

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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
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
