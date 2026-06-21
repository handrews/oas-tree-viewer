// Pure document reachability over reference edges, in the refs layer so the resolver can use it
// (e.g. to narrow `$dynamicRef` tentative targets to entry-reachable documents) without importing
// from the render layer. The render layer's `unreachableDocs` wraps this for the orphan warning.

import type { Oad } from "../types";
import type { ReferenceEdge } from "./types";

/**
 * The ids of documents reachable from the entry document by walking *static* reference edges
 * that resolve to a loaded document. `external`/`broken` edges carry no `targetDocId`, so they
 * don't propagate. Tentative edges — a Link's `operationId` and a `$dynamicRef` — also do not
 * propagate: a document reached only that way is "otherwise unreachable" and stays flagged. The
 * entry document is always reachable.
 */
export function reachableDocIds(oad: Oad, edges: ReferenceEdge[]): Set<string> {
  const reachable = new Set<string>();
  const entry = oad.documents.find((d) => d.isEntry) ?? oad.documents[0];
  if (!entry) return reachable;

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.targetDocId || e.kind === "operationId" || e.kind === "$dynamicRef") continue;
    (adj.get(e.sourceDocId) ?? adj.set(e.sourceDocId, new Set()).get(e.sourceDocId)!).add(
      e.targetDocId,
    );
  }

  const queue: string[] = [entry.id];
  reachable.add(entry.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}
