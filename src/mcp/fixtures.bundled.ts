// The Node fixture port. `import.meta.glob` bundles literally the same bytes the browser fetches
// (see fixtureUrl in src/app/demos.ts) into the built .mjs, so there is no readFile/path-resolution
// surface, no path traversal, and Node/browser parity for demo documents is a tautology rather than
// a hope. Verified in the M0 spike: this resolves all 35 fixtures under `vite.mcp.config.ts`'s SSR
// build, keyed like "../../public/fixtures/oads/openapi.yaml".

import type { FixtureSource } from "./ports";

const modules = import.meta.glob("../../public/fixtures/**/*.{yaml,json}", {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;

// Re-key from the glob's relative-path form to the "/fixtures/…" form `fixtureUrl()` produces, so
// this port is addressed identically to the browser one.
const byUrl = new Map(
  Object.entries(modules).map(([path, text]) => [
    path.replace(/^.*\/public\/fixtures\//, "/fixtures/"),
    text,
  ]),
);

export const bundledFixtures: FixtureSource = {
  async read(fixtureUrl: string): Promise<string> {
    const text = byUrl.get(fixtureUrl);
    if (text === undefined) throw new Error(`Unknown fixture: ${fixtureUrl}`);
    return text;
  },
};
