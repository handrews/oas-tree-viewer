// Materializes the OAD already loaded on the current view page into the tool's inline-documents
// shape, so `/mcp` can analyze whatever is on screen — not just a demo. `OadDocument.raw` is the
// exact source text (see src/loader.ts), so feeding it back through `toInputs` (documents.ts) and
// `runPipeline` reproduces the same OAD, whether the original source was a demo, an online URL, or
// an upload. `docId` (src/loader.ts's process-global counter) never appears here — only `filename`/
// `retrievalUri`, both of which are stable per document regardless of which pipeline run produced them.

import type { Oad } from "../types";
import type { InlineDoc } from "./documents";

export function inlineDocsFromOad(oad: Oad): InlineDoc[] {
  return oad.documents.map((d, index) => ({
    // A document always has a filename in practice (an upload requires one; a URL load derives one
    // from the fetch URL) — the fallback only guards the type, not a real-world gap.
    filename: d.filename ?? d.retrievalUri ?? `document-${index + 1}`,
    text: d.raw,
    retrievalUri: d.retrievalUri,
    isEntry: d.isEntry,
  }));
}
