import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// TypeScript in <script lang="ts"> is handled by vitePreprocess; the d3 canvas
// stays an imperative island wrapped by a Svelte component.
export default {
  preprocess: vitePreprocess(),
};
