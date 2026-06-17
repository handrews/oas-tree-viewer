import { defineConfig } from "@playwright/test";

// E2E suite for the rendered app. Runs against the Vite dev server; reuses an
// already-running one locally. Kept separate from the Vitest unit suite
// (test/**/*.test.ts) — Playwright only picks up e2e/**/*.spec.ts.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
