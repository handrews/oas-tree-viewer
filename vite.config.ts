import { defineConfig } from "vite";

export default defineConfig({
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
