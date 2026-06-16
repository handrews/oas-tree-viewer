// Types describing resolved references (edges) across an OAD.

export type RefKind = "$ref" | "operationRef";

/** Where the reference syntactically appears. */
export type RefContext = "reference" | "pathItem" | "schema" | "link";

export type RefStatus =
  | "resolved" // points at a node of the expected type
  | "type-mismatch" // points at a real node, but the wrong type
  | "broken" // resource found, but the fragment names nothing
  | "external"; // the target resource is not among the loaded documents

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
  status: RefStatus;
  /** Expected target type (for display, esp. on type-mismatch). */
  requiredType: string;
  /** Present when a target node was located (resolved or type-mismatch). */
  targetDocId?: string;
  targetNodeId?: string;
  /** The target's own expected type (for type-mismatch display). */
  targetType?: string;
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
