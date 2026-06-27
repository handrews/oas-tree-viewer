// Build the inputs the dynamic-scope analyzer needs from resolver state: the set of nodes actually
// evaluated on some entry-rooted path, that set lifted into a resource-transition graph, and the
// `$dynamicAnchor` list grouped by name. Pure transforms over the located edges and the indexes.

import type { OadDocument, TreeNode } from "../types";
import type { ReferenceEdge } from "./types";
import type { AnchorRef } from "./dynamicScope";
import { isDefsBoundary } from "./indexer";

export function nodeKey(docId: string, nodeId: string): string {
  return `${docId} ${nodeId}`;
}

/**
 * The nodes actually *evaluated* on some entry-rooted path: descend from the entry root through
 * applied positions (everything except definition stores — `$defs`/`definitions`/`components`,
 * skipped by {@link isDefsBoundary}) and follow located references. A component buried in a defs
 * store is reached only if something references it; an unreferenced one is never evaluated, so its
 * own references must not contribute dynamic-scope transitions.
 */
export function reachableNodes(
  entry: OadDocument | undefined,
  edges: ReferenceEdge[],
  pointerIndex: Map<string, Map<string, TreeNode>>,
): Set<string> {
  const reachable = new Set<string>();
  if (!entry) return reachable;
  const refAdj = new Map<string, Array<{ docId: string; nodeId: string }>>();
  for (const e of edges) {
    if (e.targetDocId == null || e.targetNodeId == null) continue;
    const k = nodeKey(e.sourceDocId, e.sourceObjectId);
    (refAdj.get(k) ?? refAdj.set(k, []).get(k)!).push({
      docId: e.targetDocId,
      nodeId: e.targetNodeId,
    });
  }
  const queue: Array<{ docId: string; node: TreeNode }> = [{ docId: entry.id, node: entry.root }];
  reachable.add(nodeKey(entry.id, entry.root.id));
  while (queue.length) {
    const { docId, node } = queue.shift()!;
    for (const child of node.children) {
      if (isDefsBoundary(child)) continue; // do not lexically descend into a definition store
      const ck = nodeKey(docId, child.id);
      if (!reachable.has(ck)) {
        reachable.add(ck);
        queue.push({ docId, node: child });
      }
    }
    for (const t of refAdj.get(nodeKey(docId, node.id)) ?? []) {
      const tk = nodeKey(t.docId, t.nodeId);
      if (reachable.has(tk)) continue;
      const tnode = pointerIndex.get(t.docId)?.get(t.nodeId);
      if (tnode) {
        reachable.add(tk);
        queue.push({ docId: t.docId, node: tnode });
      }
    }
  }
  return reachable;
}

/**
 * Lift located reference edges to resource-level transitions (deduped, self-loops dropped). Only
 * edges whose *source* node is evaluated on some entry-rooted path count — a reference inside an
 * unreachable (defined-but-unapplied) schema is never followed, so it transitions nothing.
 */
export function buildResourceEdges(
  edges: ReferenceEdge[],
  resourceOf: Map<string, Map<string, string>>,
  reachable: Set<string>,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.targetDocId == null || e.targetNodeId == null) continue;
    if (!reachable.has(nodeKey(e.sourceDocId, e.sourceObjectId))) continue;
    const from = resourceOf.get(e.sourceDocId)?.get(e.sourceObjectId);
    const to = resourceOf.get(e.targetDocId)?.get(e.targetNodeId);
    if (from == null || to == null || from === to) continue;
    const key = `${from}\n${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}

export function buildAnchorsByName(
  dynamicAnchorsByName: Map<string, Array<{ docId: string; node: TreeNode }>>,
  resourceOf: Map<string, Map<string, string>>,
): Map<string, AnchorRef[]> {
  const out = new Map<string, AnchorRef[]>();
  for (const [name, list] of dynamicAnchorsByName) {
    const refs: AnchorRef[] = [];
    for (const { docId, node } of list) {
      const resourceUri = resourceOf.get(docId)?.get(node.id);
      if (resourceUri != null) refs.push({ resourceUri, docId, node });
    }
    out.set(name, refs);
  }
  return out;
}
