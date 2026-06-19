import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    projects: [
      {
        // Pure-logic + jsdom DOM specs. DOM specs opt in with a
        // `// @vitest-environment jsdom` docblock at the top of the file.
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/browser/**"],
        },
      },
      {
        // Real-browser component/integration specs (the d3 island needs real
        // layout: getBBox/fit). Driven by vitest-browser-svelte in Playwright.
        plugins: [svelte()],
        // Resolve svelte to its client build (mount lives there, not in the
        // default SSR entry index-server.js).
        resolve: { conditions: ["browser"] },
        // Pre-bundle the island's deps so the browser run doesn't reload mid-test.
        optimizeDeps: { include: ["d3", "yaml"] },
        test: {
          name: "browser",
          include: ["test/browser/**/*.svelte.test.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Measure against all source, not just files a test happened to import.
      include: ["src/**/*.{ts,svelte}"],
      exclude: [
        "src/main.ts", // bootstrap / mount
        "src/App.svelte", // shell wiring (verified in-browser + e2e)
        "src/pages/ConfigurePage.svelte", // presentation (logic in oadForm/demos/viewUrl; browser-verified)
        "src/pages/ViewPage.svelte", // presentation (logic in bootstrap/reachability/issues; browser-verified)
        "src/app/router.svelte.ts", // live history/location wiring (browser-verified; parsing covered in viewUrl)
        "src/app/session.svelte.ts", // in-memory handoff holder (browser-verified)
        "src/render/canvas.ts", // SVG + d3 (verified in-browser)
        "src/render/treeView.ts", // SVG + d3 (verified in-browser)
        "src/render/TreeCanvas.svelte", // d3 island wrapper (verified in-browser)
        "src/render/DetailPanel.svelte", // presentation (logic lives in detail.ts; browser-verified)
        "src/render/Legend.svelte", // presentation (legend data lives in colors.ts; browser-verified)
        "src/render/IssueReport.svelte", // presentation (logic lives in issues.ts; browser-verified)
        "src/ui/OadForm.svelte", // presentation (logic lives in oadForm.ts; browser-verified)
        "src/ui/fileDrop.ts", // drag-drop / FileSystem Entry API (browser-verified)
        "src/ui/ThemeToggle.svelte", // presentation (logic lives in theme.ts; browser-verified)
        "src/types.ts", // type declarations only
        "src/refs/types.ts", // type declarations (+ trivial refKey)
        "src/vite-env.d.ts",
      ],
      // Floors sit just under the measured baseline so the gate blocks
      // regressions without being flaky.
      thresholds: {
        statements: 93,
        branches: 80,
        functions: 95,
        lines: 94,
      },
    },
  },
});
