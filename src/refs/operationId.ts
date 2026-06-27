// Resolve a Link Object's `operationId` against a global index of every Operation in the OAD
// (unique by construction — assembleOad rejects duplicates), drawn as an implicit `operation-id`
// edge.

import type { TreeNode } from "../types";
import type { ReferenceEdge } from "./types";
import { childString, type OpIdSource } from "./indexer";

/** Index every Operation by its `operationId` (unique across the OAD — `assembleOad` guards). */
export function buildOperationIdIndex(
  pointerIndex: Map<string, Map<string, TreeNode>>,
): Map<string, { docId: string; node: TreeNode }> {
  const index = new Map<string, { docId: string; node: TreeNode }>();
  for (const [docId, pidx] of pointerIndex) {
    for (const node of pidx.values()) {
      if (node.oasType !== "Operation Object") continue;
      const operationId = childString(node, "operationId");
      if (operationId !== undefined && !index.has(operationId))
        index.set(operationId, { docId, node });
    }
  }
  return index;
}

/**
 * Resolve a Link's `operationId` into an implicit `operation-id` edge (drawn like a component
 * name). Exactly one match → resolved; none → broken. Duplicates can't reach here — they are an
 * OAD-level load error — so there is no ambiguous outcome.
 */
export function resolveOperationId(
  src: OpIdSource,
  index: Map<string, { docId: string; node: TreeNode }>,
  id: string,
): ReferenceEdge {
  src.fieldNode.resolvedAs = "operation-id";
  const target = index.get(src.operationId);
  const edge: ReferenceEdge = {
    id,
    sourceDocId: src.doc.id,
    sourceNodeId: src.fieldNode.id,
    sourceObjectId: src.linkNode.id,
    refString: src.operationId,
    kind: "operationId",
    context: "link",
    resolution: "operation-id",
    status: target ? "resolved" : "broken",
    requiredType: "Operation",
  };
  if (target) {
    edge.targetDocId = target.docId;
    edge.targetNodeId = target.node.id;
    edge.targetType = target.node.expectedType;
  }
  return edge;
}
