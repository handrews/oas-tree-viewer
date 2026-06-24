import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

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
        // Mirror the app build's version define so App (which reads __APP_VERSION__)
        // resolves it the same way production does.
        define: {
          __APP_VERSION__: JSON.stringify(pkg.version),
        },
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
        "src/app/pipeline.worker.ts", // worker entry / bootstrap (runs runPipeline; browser-verified)
        "src/app/pipelineClient.ts", // live Worker wiring (browser-verified; can't instantiate in node)
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
      // Statement/branch/line floors sit ~1 point under the measured coverage (98.2 / 92.1 / 99.4) so
      // the gate blocks regressions without flaking on a defensive arm or hard-to-trigger catch.
      // Functions is held at 100: every function should be exercised, an uncovered one means dead code
      // or a missing test, and the coverage-included files are all node-tested (so it's deterministic).
      // The d3/SVG islands (canvas.ts, treeView.ts) are excluded above; the tree's keyboard model lives
      // in the node-tested treeKeys.ts instead.
      thresholds: {
        statements: 97,
        branches: 91,
        functions: 100,
        lines: 98,
      },
    },
  },
});
