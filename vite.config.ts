import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { docPages } from "./vite/doc-pages";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig(({ mode }) => {
  // In production the app is served under a sub-path of the main site
  // (https://henryandrews.net/projects/oas); dev and the e2e suite run at the root for simplicity. The
  // Vite `base` (exposed as `import.meta.env.BASE_URL`) is the single source of truth the router
  // strips/prepends (src/app/router.svelte.ts) and that the Cloudflare Worker (worker/index.js) mirrors.
  const base = mode === "production" ? "/projects/oas/" : "/";
  return {
    base,
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
      // Nest the output under the sub-path so the files' layout matches their URLs: Cloudflare's route
      // (henryandrews.net/projects/oas/*) then serves assets straight from dist/projects/oas/, and the
      // Worker only handles the SPA fallback. Derived from `base` so the two never drift ("dist" at root).
      outDir: "dist" + base.replace(/\/$/, ""),
    },
  };
});
