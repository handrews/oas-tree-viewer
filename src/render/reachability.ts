// Document reachability across an OAD: which loaded documents can be reached from the entry
// document by following resolved references. A document that is loaded (e.g. part of a folder
// bundle) but reachable from nothing is an orphan — surfaced as a non-fatal warning.

import type { Oad, OadDocument } from "../types";
import type { ResolvedRefs } from "../refs/types";

/**
 * The ids of documents reachable from the entry document by walking reference edges that
 * resolve to a *loaded* document. `external`/`broken` edges carry no `targetDocId`, so they
 * don't propagate reachability — correct, since their target isn't among the loaded docs.
 * The entry document is always reachable.
 */
export function reachableDocIds(oad: Oad, refs: ResolvedRefs): Set<string> {
  const reachable = new Set<string>();
  const entry = oad.documents.find((d) => d.isEntry) ?? oad.documents[0];
  if (!entry) return reachable;

  // Adjacency: source doc -> located target docs.
  const adj = new Map<string, Set<string>>();
  for (const e of refs.edges) {
    if (!e.targetDocId) continue;
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

/** Loaded documents not reachable from the entry document, in document order. */
export function unreachableDocs(oad: Oad, refs: ResolvedRefs): OadDocument[] {
  const reachable = reachableDocIds(oad, refs);
  return oad.documents.filter((d) => !reachable.has(d.id));
}
