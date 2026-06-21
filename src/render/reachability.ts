// Document reachability across an OAD for the render layer's orphan warning: which loaded
// documents can be reached from the entry document by following resolved references. A document
// that is loaded (e.g. part of a folder bundle) but reachable from nothing is an orphan — surfaced
// as a non-fatal warning. The reachability walk itself lives in the refs layer (pure, edge-based).

import type { Oad, OadDocument } from "../types";
import type { ResolvedRefs } from "../refs/types";
import { reachableDocIds as reachableFromEdges } from "../refs/reachability";

/** docIds reachable from the entry document by walking the resolved reference edges. */
export function reachableDocIds(oad: Oad, refs: ResolvedRefs): Set<string> {
  return reachableFromEdges(oad, refs.edges);
}

/** Loaded documents not reachable from the entry document, in document order. */
export function unreachableDocs(oad: Oad, refs: ResolvedRefs): OadDocument[] {
  const reachable = reachableFromEdges(oad, refs.edges);
  return oad.documents.filter((d) => !reachable.has(d.id));
}
