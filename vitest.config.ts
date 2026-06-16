import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Most specs are pure logic (node). DOM specs opt in with a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Measure against all source, not just files a test happened to import.
      include: ["src/**/*.ts"],
      exclude: [
        "src/main.ts", // bootstrap / DOM wiring
        "src/render/canvas.ts", // SVG + d3 (verified in-browser)
        "src/render/treeView.ts", // SVG + d3 (verified in-browser)
        "src/types.ts", // type declarations only
        "src/refs/types.ts", // type declarations (+ trivial refKey)
      ],
      // Floors sit just under the measured baseline (stmts 95 / branch 84 /
      // funcs 100 / lines 97) so the gate blocks regressions without being flaky.
      thresholds: {
        statements: 93,
        branches: 80,
        functions: 95,
        lines: 94,
      },
    },
  },
});
