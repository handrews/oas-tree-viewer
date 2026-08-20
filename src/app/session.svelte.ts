// One-shot in-memory handoff for interactive uploads. Uploaded files can't be encoded in a
// bookmarkable URL (and we don't persist them), so the configure page resolves them up
// front and stashes the result here; the view page consumes it for a bare `/view`. A full
// page reload clears it — which is exactly why a reloaded upload view shows its empty state.
// `mcpDocs` is the same idea for `/mcp`: raw (unresolved) document text for a source that included
// an upload, since `/mcp` wants inline documents, not a rendered OAD.

import type { Oad } from "../types";
import type { ResolvedRefs } from "../refs/types";
import type { Diagnostic } from "../diagnostics/types";
import type { ViewerConfig } from "./config";
import type { ViewRequest } from "./viewUrl";

export interface SessionResult {
  oad: Oad;
  refs: ResolvedRefs;
  diagnostics: Diagnostic[];
}

/**
 * The most recently rendered view, for any source (demo, online URLs, or upload) — unlike `result`,
 * which is written only on the upload path. `/mcp` reads this to analyze whatever is currently on
 * screen: `oad.documents[].raw` is the exact source text, so `inlineDocsFromOad` (src/mcp/fromOad.ts)
 * can reproduce it. Never cleared (matching `result`'s lifecycle) — a full reload drops it, which is
 * why a cold `/mcp` falls back to the demo id in its own URL instead.
 */
export interface SessionCurrent {
  oad: Oad;
  diagnostics: Diagnostic[];
  config: ViewerConfig;
  request: ViewRequest;
}

/**
 * One raw document as ConfigurePage's "Try it over MCP" hands it off — structurally `InlineDoc`
 * (src/mcp/documents.ts) but declared locally rather than imported: this module must not pull the
 * MCP layer into the entry chunk (McpPage.svelte is the code-split boundary — see App.svelte).
 */
export interface McpRawDoc {
  filename: string;
  text: string;
  retrievalUri?: string;
  isEntry: boolean;
}

/**
 * A one-shot handoff of raw document text for `/mcp`, for a source that included at least one
 * upload — an uploaded file can't live in a URL, so unlike a URL-only source (encoded straight into
 * `mcpPath`'s `urls` request) it can't be reproduced from the address bar alone. `request` is always
 * `{ kind: "session" }`: like `session.result`, there is no bookmarkable request behind these docs,
 * only this in-memory set. A full page reload clears it, same as `result`/`current`.
 */
export interface McpDocsHandoff {
  docs: McpRawDoc[];
  config: ViewerConfig;
  request: ViewRequest;
}

export const session = $state<{
  result: SessionResult | null;
  current: SessionCurrent | null;
  mcpDocs: McpDocsHandoff | null;
}>({
  result: null,
  current: null,
  mcpDocs: null,
});
