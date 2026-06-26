// Pure helpers for the detail panel: document labels, scalar formatting, and selecting
// the reference edges that touch a node. Kept out of the .svelte component so the logic
// is unit-testable (the component is presentation, verified in-browser).

import type { OadDocument, SourceRange, TreeNode } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "../refs/types";
import { refKey } from "../refs/types";
import { dialectLabel } from "../oas/dialects";

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

/** The source range of a node within its document, if the position pass located it. */
export function nodeRange(doc: OadDocument, node: TreeNode): SourceRange | undefined {
  return doc.positions?.get(node.id);
}

/**
 * The version/dialect line for a document header: the OAS version, a JSON Schema dialect, or — for a
 * fragment — its inferred root type ("Fragment · Path Item Object"), "partially typed" when only
 * interior nodes were typed, or "ambiguous root" / "type undetermined" when it could not be typed.
 */
export function docVersionLabel(doc: OadDocument): string {
  if (doc.kind === "fragment") {
    if (doc.fragmentAmbiguous) return "Fragment · ambiguous root";
    if (doc.root.oasType) return `Fragment · ${doc.root.oasType}`;
    if (doc.fragmentInteriorTyped) return "Fragment · partially typed";
    return "Fragment · type undetermined";
  }
  return doc.kind === "schema" ? dialectLabel(doc.schemaDialect) : `OAS ${doc.oasVersion}`;
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
