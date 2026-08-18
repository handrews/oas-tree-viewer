import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Root base so `import.meta.env.BASE_URL` is "/", making `fixtureUrl()` yield "/fixtures/<name>";
// the fixture port keys its bundled map on that. `publicDir: false` lets public/fixtures be
// imported as data rather than copied as assets.
export default defineConfig({
  base: "/",
  publicDir: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  ssr: { target: "node" },
  build: {
    ssr: true,
    target: "node24",
    outDir: "dist-mcp",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: { stdio: "src/mcp/hosts/stdio.ts" },
      external: [/^node:/],
      output: { format: "es", entryFileNames: "[name].mjs", chunkFileNames: "[name]-[hash].mjs" },
    },
  },
});
