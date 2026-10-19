import { defineConfig } from "vitest/config";

// Application logic is DOM-free, so the suite runs in the node environment. Browser behaviour is Playwright's job
// (tests/browser/), never jsdom's.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
