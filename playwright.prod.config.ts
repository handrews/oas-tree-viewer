import { defineConfig } from "@playwright/test";

// Production-base leg: runs a real production build (`vite build`, base "/projects/oas/" per
// vite.config.ts) under `vite preview`, instead of the dev server's root base. `playwright.config.ts`
// can't see deploy-base bugs — a root-relative goto("/x") or a hardcoded "/fixtures/..." URL bypasses
// any baseURL path prefix and happens to still work at "/", masking a bug that only shows up once the
// app is actually served from a sub-path. Scoped to a fast, high-value subset (all of mcp.spec.ts, plus
// a "@smoke" tagged slice of render.spec.ts) rather than the full suite, since it pays a full build on
// every run; the a11y spec stays dev-only.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // Trailing slash matters: goto("view?...")-style relative paths in the specs below resolve
    // against this exactly the way they do under playwright.config.ts's dev baseURL.
    baseURL: "http://localhost:4173/projects/oas/",
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    trace: "on-first-retry",
  },
  projects: [
    // The whole MCP spec: it's the surface that most directly depends on BASE_URL-derived paths
    // (src/mcp/documents.ts's fixturePath, src/app/demos.ts's fixtureUrl).
    { name: "mcp", testMatch: /mcp\.spec\.ts$/ },
    // Only the tests tagged "@smoke" — enough of render.spec.ts's routing/bookmarking/fixture-URL
    // coverage to catch a sub-path regression, without re-running the whole (slower) rendering suite
    // against a full build on every push.
    { name: "render-smoke", testMatch: /render\.spec\.ts$/, grep: /@smoke/ },
  ],
  webServer: {
    // No dev server here: the whole point is to exercise the artifact that actually ships.
    command: "npm run build && npm run preview",
    url: "http://localhost:4173/projects/oas/",
    reuseExistingServer: !process.env.CI,
    // Longer than the dev leg's: this waits out a full build (svelte-check + vite build), not just
    // a dev server boot.
    timeout: 180_000,
  },
});
