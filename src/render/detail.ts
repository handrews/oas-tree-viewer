// Pure helpers for the detail panel: document labels, scalar formatting, and selecting
// the reference edges that touch a node. Kept out of the .svelte component so the logic
// is unit-testable (the component is presentation, verified in-browser).

import type { OadDocument } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "../refs/types";
import { refKey } from "../refs/types";

export interface DetailContext {
  refs: ResolvedRefs;
  docLabel: (docId: string) => string;
  onNavigate: (docId: string, nodeId: string) => void;
}

/** Display name for a document. */
export function docName(doc: OadDocument): string {
  return doc.filename ?? doc.retrievalUri ?? `(${doc.source} document)`;
}

/** Base URI shown for a document ($self takes precedence over the retrieval URI). */
export function baseUri(doc: OadDocument): string | undefined {
  return doc.selfUri ?? doc.retrievalUri;
}

/** Stringify a scalar leaf value for display. */
export function formatScalar(value: string | number | boolean | null | undefined): string {
  return typeof value === "string" ? value : String(value);
}

function dedupe(edges: ReferenceEdge[]): ReferenceEdge[] {
  const seen = new Map<string, ReferenceEdge>();
  for (const e of edges) seen.set(e.id, e);
  return [...seen.values()];
}

/** Edges where this node is the reference source ("resolves to →"). */
export function outgoingRefs(refs: ResolvedRefs, docId: string, nodeId: string): ReferenceEdge[] {
  return dedupe(refs.bySource.get(refKey(docId, nodeId)) ?? []);
}

/** Edges where this node is the reference target ("referenced by ←"). */
export function incomingRefs(refs: ResolvedRefs, docId: string, nodeId: string): ReferenceEdge[] {
  return dedupe(refs.byTarget.get(refKey(docId, nodeId)) ?? []);
}
