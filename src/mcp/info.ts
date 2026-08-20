// Server identity and shared constants, kept in one place so the name stamped into `McpServer`'s
// Implementation, the tool names both server.ts and its tests key off, the inline-document caps
// enforced in schemas.ts, and the wire log's connect-action label all have one home. SDK-free, so
// McpPage.svelte can import it statically without pulling hosts/browser.ts (and the SDK + zod it
// carries) out of its dynamic-import boundary — see App.svelte.

export const SERVER_NAME = "oas-structure-viewer";

export const TOOL_NAMES = {
  analyzeDocument: "analyze-document",
  explainDiagnostic: "explain-diagnostic",
} as const;

// Inline `documents[]` input has no Worker isolation and no upload-form gate the way the browser
// does, so the tool enforces its own count/size guard rather than inheriting the viewer's
// (deliberately unbounded, worker-protected) `defaultLimits` — see src/limits.ts.
export const MAX_INLINE_DOCS = 20;
export const MAX_DOC_CHARS = 1_000_000;

// The label `McpBrowserHost.beginAction` stamps on every wire exchange before the first user
// action — what WireLog.svelte groups by, and what its connect-group summary link (McpPage.svelte)
// must read verbatim so the two never drift apart.
export const CONNECT_ACTION = "Connect and discover capabilities";
