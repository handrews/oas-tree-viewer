import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built assets resolve wherever the app is served from —
  // a domain root, a subdirectory, or a vendored copy in another site.
  base: "./",
  // Keep the dev server simple; the app is fully client-side.
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
