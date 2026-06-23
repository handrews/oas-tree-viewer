// Document fragments: a loaded document that is neither a complete OpenAPI document nor a JSON Schema
// document (enabled by the `allowFragments` config). A fragment is loaded unclassified; its root type
// is inferred here from the *references that target its root*, which then classifies the whole tree.
//
// Classification normally precedes resolution, but a fragment's root type is known only *from*
// resolution — so this is a fixpoint: resolve over what's classified so far, infer each still-untyped
// fragment's root type from the edges that hit its root, classify it, and repeat (which also propagates
// types along fragment → fragment chains). The final resolve happens back in the pipeline.

import type { Oad } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "./types";
import type { ViewerConfig } from "../app/config";
import { resolveOad } from "./resolver";
import { classifyAsGeneric, classifyDocument } from "../oas/classify";

/**
 * Infer and classify every document-fragment root from the references that target it, mutating the
 * fragment trees in place. A root takes the expected type of the reference(s) pointing at it; two
 * references that disagree make it ambiguous (generic, `fragmentAmbiguous`). Returns an OAD-level error
 * string when the **entry** document is a fragment no reference reached, else `null` (a non-entry
 * untyped fragment is classified generic and will render as unreachable).
 */
export function typeFragments(oad: Oad, config: ViewerConfig): string | null {
  const fragments = oad.documents.filter((d) => d.kind === "fragment");
  if (fragments.length === 0) return null;

  const typed = new Set<string>();

  // Fixpoint: at most one fragment is typed per pass, so this terminates in ≤ (#fragments + 1) passes.
  let progressed = true;
  while (progressed) {
    progressed = false;
    const { edges } = resolveOad(oad, config);
    for (const frag of fragments) {
      if (typed.has(frag.id)) continue;
      const types = rootRequiredTypes(edges, frag.id);
      if (types.length === 0) continue; // not yet reached by any typing reference
      if (types.length === 1) {
        classifyDocument(frag.root, oad.versionFamily, "fragment", types[0]);
      } else {
        classifyAsGeneric(frag.root);
        frag.fragmentAmbiguous = true;
      }
      typed.add(frag.id);
      progressed = true;
    }
  }

  for (const frag of fragments) {
    if (typed.has(frag.id)) continue;
    if (frag.isEntry) {
      return (
        "The entry document is a fragment whose root type could not be determined: no reference " +
        "points at its root. Load a complete OpenAPI or JSON Schema document as the entry, or a " +
        "document that references this fragment."
      );
    }
    classifyAsGeneric(frag.root); // unreferenced, non-entry: render generic (and unreachable)
  }
  return null;
}

/** The distinct non-empty expected types of the references that target a document's root (id `""`). */
function rootRequiredTypes(edges: ReferenceEdge[], docId: string): string[] {
  const types = new Set<string>();
  for (const e of edges) {
    if (e.targetDocId === docId && e.targetNodeId === "" && e.requiredType) types.add(e.requiredType);
  }
  return [...types];
}

/**
 * After the final resolve, mark references to an **ambiguous** fragment as type errors: its root type
 * is undetermined, so the references that disagree at its root *and* any reference into one of its
 * (now generic) locations are errors. Mutates the edges in place.
 */
export function markFragmentEdges(oad: Oad, refs: ResolvedRefs): void {
  const ambiguous = new Set(
    oad.documents.filter((d) => d.kind === "fragment" && d.fragmentAmbiguous).map((d) => d.id),
  );
  if (ambiguous.size === 0) return;
  for (const e of refs.edges) {
    if (
      e.targetDocId != null &&
      ambiguous.has(e.targetDocId) &&
      (e.status === "resolved" || e.status === "type-mismatch")
    ) {
      e.status = "type-mismatch";
      e.targetType = "(ambiguous root)";
    }
  }
}
