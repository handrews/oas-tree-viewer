// The whole runtime seam between the MCP layer and its host. Injected rather than imported live so
// `analyze.ts`/`documents.ts` stay host-agnostic and testable without a real fixture host: Node
// bundles fixture text at build time (fixtures.bundled.ts), a later browser host fetches it.

/** Reads one fixture's raw text, addressed the same way `fixtureUrl()` (src/app/demos.ts) names it. */
export interface FixtureSource {
  read(fixtureUrl: string, signal?: AbortSignal): Promise<string>;
}

/** Everything a tool handler needs. */
export interface McpDeps {
  fixtures: FixtureSource;
  version: string;
}
