// Flat ESLint config (ESLint 10 / typescript-eslint 8 / eslint-plugin-svelte 3). Runs alongside
// svelte-check (types) and Prettier (formatting): ESLint owns code-quality rules only, so
// eslint-config-prettier is applied last to switch off any stylistic rules that would fight Prettier.
//
// The rule sets are the non-type-checked `recommended` ones — fast, and a clean fit for the existing
// code (which is already strict-TS clean). Type-checked rules are a possible future tightening. The few
// rule tweaks below align ESLint with the project's established, deliberate conventions rather than
// changing source — the existing code is the definition of "clean" here.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";
import svelteConfig from "./svelte.config.js";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "coverage/",
      "node_modules/",
      "public/",
      "playwright-report/",
      "test-results/",
      // Wrangler local state (`wrangler dev`/`deploy`) — gitignored build artifacts, not source.
      ".wrangler/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  svelte.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // Baked in at build time by Vite's `define` (see vite.config.ts).
        __APP_VERSION__: "readonly",
      },
    },
  },
  {
    // TypeScript inside Svelte components AND the `.svelte.ts` rune modules needs the TS parser as
    // svelte-eslint-parser's sub-parser, plus the project's svelte.config.js (for the preprocessor).
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        svelteConfig,
      },
    },
  },
  prettier,
  {
    rules: {
      // Match tsconfig's `noUnusedParameters`/`noUnusedLocals`, which ignore a leading underscore
      // (a deliberately-unused binding, e.g. an unused signature parameter).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // The `let x = null; try { x = … } catch { x = null }` initialize-then-assign pattern is a
      // deliberate, clear idiom here, not a mistake.
      "no-useless-assignment": "off",
      // The Maps in components are non-reactive locals (built inside handlers), not reactive state, so
      // a plain Map is correct — SvelteMap is not needed.
      "svelte/prefer-svelte-reactivity": "off",
    },
  },
);
