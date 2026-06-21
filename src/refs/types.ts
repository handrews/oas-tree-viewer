// Types describing resolved references (edges) across an OAD.

import type { ResolutionKind } from "../types";

export type RefKind =
  | "$ref"
  | "$dynamicRef"
  | "operationRef"
  | "operationId"
  | "discriminatorMapping"
  | "securityRequirement";

/** Where the reference syntactically appears. */
export type RefContext =
  | "reference"
  | "pathItem"
  | "schema"
  | "link"
  | "discriminatorMapping"
  | "securityRequirement";

export type RefStatus =
  | "resolved" // points at a node of the expected type
  | "type-mismatch" // points at a real node, but the wrong type
  | "broken" // resource found, but the fragment names nothing
  | "external"; // the target resource is not among the loaded documents

/**
 * A semantic problem with a reference that *does* resolve — orthogonal to {@link RefStatus}.
 * An `operationRef`/`operationId` can resolve to a real Operation yet point somewhere that
 * isn't (unambiguously) invocable, and a Path Item `$ref` can resolve yet undefined-merge with
 * its target. These are surfaced as advisories rather than folded into the resolve status.
 */
export type DiagnosticCode =
  | "pathitem-field-overlap" // a field appears next to the $ref AND in the target Path Item
  | "operation-target-webhook" // op ref → Operation under `webhooks` (not directly callable)
  | "operation-target-callback" // op ref → Operation under a `callbacks` entry (runtime URL)
  | "operation-target-ambiguous" // op ref → component Path Item reached by >1 path (which URL?)
  | "operation-target-fragile" // op ref → component Path Item reached by exactly 1 path
  | "operation-target-no-path"; // op ref → component Path Item reached by 0 paths (no URL)

export interface EdgeDiagnostic {
  code: DiagnosticCode;
  /** Report grouping; the on-canvas/legend color is keyed off this (see colors.ts). */
  severity: "error" | "warning";
  /** Color-free human text, e.g. 'also defined in the target: summary, parameters'. */
  detail: string;
}

export interface ReferenceEdge {
  id: string;
  /** Document holding the reference. */
  sourceDocId: string;
  /** The `$ref` / `operationRef` field row (its JSON Pointer id) — the arc's source. */
  sourceNodeId: string;
  /** The object bearing the reference (Reference / Schema / Path Item / Link). */
  sourceObjectId: string;
  refString: string;
  /** The absolute URI the reference resolved to, for display. */
  resolvedUri?: string;
  kind: RefKind;
  context: RefContext;
  /** How the reference was interpreted; selects the arrow/marker style. */
  resolution: ResolutionKind;
  status: RefStatus;
  /** Expected target type (for display, esp. on type-mismatch). */
  requiredType: string;
  /** Present when a target node was located (resolved or type-mismatch). */
  targetDocId?: string;
  targetNodeId?: string;
  /** The target's own expected type (for type-mismatch display). */
  targetType?: string;
  /** Semantic advisories on an otherwise-resolved reference (set by annotateDiagnostics). */
  diagnostics?: EdgeDiagnostic[];
}

export interface ResolvedRefs {
  edges: ReferenceEdge[];
  /** Edges keyed by `${docId} ${nodeId}` for the source field *and* source object. */
  bySource: Map<string, ReferenceEdge[]>;
  /** Edges keyed by `${docId} ${nodeId}` for the resolved/located target. */
  byTarget: Map<string, ReferenceEdge[]>;
}

/** Compose the map key used by `bySource` / `byTarget`. */
export function refKey(docId: string, nodeId: string): string {
  return `${docId} ${nodeId}`;
}
