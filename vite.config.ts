import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { docPages } from "./vite/doc-pages";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  // Relative base so the built assets resolve wherever the app is served from —
  // a domain root, a subdirectory, or a vendored copy in another site.
  base: "./",
  // Bake the package version in at build time so the header can show the running
  // version and link it to that release's changelog entry.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [svelte(), docPages()],
  // The pipeline runs in a module worker (src/app/pipeline.worker.ts) whose validator pulls in
  // Hyperjump via dynamic import; build the worker as ES so those nested imports resolve as chunks
  // (the default "iife" worker format can't host top-level or dynamic ESM).
  worker: {
    format: "es",
  },
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
