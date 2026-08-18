// One-shot in-memory handoff for interactive uploads. Uploaded files can't be encoded in a
// bookmarkable URL (and we don't persist them), so the configure page resolves them up
// front and stashes the result here; the view page consumes it for a bare `/view`. A full
// page reload clears it — which is exactly why a reloaded upload view shows its empty state.

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

export const session = $state<{ result: SessionResult | null; current: SessionCurrent | null }>({
  result: null,
  current: null,
});
