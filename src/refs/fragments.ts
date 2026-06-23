// Document fragments: a loaded document that is neither a complete OpenAPI document nor a JSON Schema
// document (enabled by the `fragments` config — "root" or "any"). A fragment is loaded unclassified;
// its type is inferred here from the *references that target it* — its root (phase 2) or, in "any" mode,
// any interior node (phase 3). Only a referenced node and its descendants take a type; the rest of the
// document stays generic.
//
// Classification normally precedes resolution, but a fragment's types are known only *from* resolution —
// so this is a fixpoint: resolve over what's classified so far, read each fragment's typing anchors off
// the edges that target it, re-derive its classification, and repeat (which propagates types along
// fragment → fragment chains and surfaces interior anchors that only appear once an enclosing fragment
// is classified). The final resolve + edge marking happen back in the pipeline.
//
// Type conflicts: a node's type is over-determined when two references target it expecting different
// types, or a reference's type disagrees with the type an enclosing referenced ancestor implies for it.
// The contested node's subtree is blanked to generic and references into it become type errors; the rest
// of the fragment keeps its inferred types. A conflict at the root makes the whole document generic.

import type { Oad, OadDocument, TreeNode, VersionFamily } from "../types";
import type { ResolvedRefs } from "./types";
import type { ViewerConfig } from "../app/config";
import { resolveOad } from "./resolver";
import { clearClassification, classifyDocument } from "../oas/classify";

/** A node directly targeted by one or more typing references, with the distinct types they expect. */
interface Anchor {
  node: TreeNode;
  types: Set<string>;
}
type AnchorMap = Map<string, Anchor>; // nodeId -> anchor

/**
 * Infer and classify every document fragment from the references that target it, mutating the fragment
 * trees in place. Runs a fixpoint of resolve → read anchors → re-classify until the anchor set is stable.
 * Returns an OAD-level error string when a fragment cannot be loaded under the active tier (an entry
 * fragment whose root is not cleanly typed; or, in "root" mode, a non-entry fragment with no root
 * reference), else `null`.
 */
export function typeFragments(oad: Oad, config: ViewerConfig): string | null {
  const fragments = oad.documents.filter((d) => d.kind === "fragment");
  if (fragments.length === 0) return null;
  const mode = config.fragments; // "root" | "any" (a fragment never loads under "none")

  // Node trees are structurally stable across passes (only their classification fields change), so index
  // each fragment's nodes by JSON-Pointer id once — anchor collection needs the TreeNode behind an edge.
  const nodeIndex = new Map<string, Map<string, TreeNode>>();
  for (const frag of fragments) nodeIndex.set(frag.id, indexNodes(frag.root));

  let prevSig: string | null = null;
  const maxPasses = oad.documents.length + 1; // guards a pathological non-monotonic anchor set
  for (let pass = 0; pass < maxPasses; pass++) {
    const { edges } = resolveOad(oad, config);
    const anchorsByDoc = collectAnchors(edges, fragments, nodeIndex, mode);
    const sig = signatureOf(anchorsByDoc);
    if (sig === prevSig) break; // stable — the classification already reflects this anchor set
    prevSig = sig;
    for (const frag of fragments) {
      clearClassification(frag.root); // re-derive from scratch each pass
      frag.fragmentAmbiguous = undefined;
      frag.fragmentContested = undefined;
      frag.fragmentInteriorTyped = undefined;
      applyAnchors(frag, anchorsByDoc.get(frag.id), oad.versionFamily);
    }
  }

  // Fragments left without a usable typing reference: enforce the tier rules.
  for (const frag of fragments) {
    if (frag.isEntry) {
      // A fragment can't be an entry document unless something cleanly types its root.
      if (frag.root.oasType === undefined || frag.fragmentAmbiguous) return entryError();
      continue;
    }
    const typed =
      frag.root.oasType !== undefined ||
      frag.fragmentAmbiguous ||
      frag.fragmentInteriorTyped ||
      (frag.fragmentContested?.length ?? 0) > 0;
    if (typed) continue;
    if (mode === "root") return rootMissError(frag);
    // "any" mode: an unreachable fragment is tolerated — it stays generic (from clearClassification).
  }
  return null;
}

/** Per-fragment map of typing anchors, read off the resolved edges (mode-filtered). */
function collectAnchors(
  edges: ResolvedRefs["edges"],
  fragments: OadDocument[],
  nodeIndex: Map<string, Map<string, TreeNode>>,
  mode: ViewerConfig["fragments"],
): Map<string, AnchorMap> {
  const out = new Map<string, AnchorMap>();
  for (const frag of fragments) out.set(frag.id, new Map());
  for (const e of edges) {
    if (e.targetDocId == null || e.targetNodeId == null || !e.requiredType) continue;
    const anchors = out.get(e.targetDocId);
    if (!anchors) continue; // target isn't a fragment
    if (mode === "root" && e.targetNodeId !== "") continue; // root-only typing
    const node = nodeIndex.get(e.targetDocId)?.get(e.targetNodeId);
    if (!node) continue;
    let anchor = anchors.get(e.targetNodeId);
    if (!anchor) anchors.set(e.targetNodeId, (anchor = { node, types: new Set() }));
    anchor.types.add(e.requiredType);
  }
  return out;
}

/**
 * Classify a fragment's anchor subtrees outermost-first, flagging conflicts. A node is **contested**
 * when two references disagree at it, or when its expected type disagrees with the type an already-typed
 * enclosing ancestor implies for it. A contested root makes the whole document generic
 * (`fragmentAmbiguous`); contested interior nodes have their subtrees blanked and are recorded in
 * `fragmentContested`.
 */
function applyAnchors(frag: OadDocument, anchors: AnchorMap | undefined, version: VersionFamily): void {
  if (!anchors || anchors.size === 0) return; // nothing types this fragment (stays generic)

  const contested = new Set<string>();
  for (const [nodeId, anchor] of anchors) {
    if (anchor.types.size > 1) contested.add(nodeId); // two references disagree at the same node
  }

  let interiorTyped = false;
  for (const [nodeId, anchor] of [...anchors].sort((a, b) => depthOf(a[0]) - depthOf(b[0]))) {
    if (contested.has(nodeId)) continue;
    const direct = [...anchor.types][0]!;
    const implied = anchor.node.expectedType; // set by a shallower anchor's walk, if any
    if (implied !== undefined && implied !== direct) {
      contested.add(nodeId); // ancestor's type implies something different here
      continue;
    }
    classifyDocument(anchor.node, version, "fragment", direct); // types this subtree
    if (nodeId !== "") interiorTyped = true;
  }

  if (contested.has("")) {
    // The root type is over-determined → the whole document is generic and every incoming ref errors.
    frag.fragmentAmbiguous = true;
    clearClassification(frag.root);
    return;
  }

  // Keep only the outermost contested ids (a region covers its descendants), then blank those subtrees.
  const regions = outermost([...contested]);
  for (const nodeId of regions) clearClassification(anchors.get(nodeId)!.node);
  if (regions.length) frag.fragmentContested = regions;
  if (frag.root.oasType === undefined && interiorTyped) frag.fragmentInteriorTyped = true;
}

/**
 * After the final resolve, mark references into a generic/contested region of a fragment as type errors.
 * A region is the whole document for an ambiguous root, else each contested interior subtree. Mutates the
 * edges in place.
 */
export function markFragmentEdges(oad: Oad, refs: ResolvedRefs): void {
  const byDoc = new Map<string, { regions: string[]; label: string }>();
  for (const frag of oad.documents) {
    if (frag.kind !== "fragment") continue;
    if (frag.fragmentAmbiguous) byDoc.set(frag.id, { regions: [""], label: "(ambiguous root)" });
    else if (frag.fragmentContested?.length) {
      byDoc.set(frag.id, { regions: frag.fragmentContested, label: "(contested type)" });
    }
  }
  if (byDoc.size === 0) return;
  for (const e of refs.edges) {
    if (e.targetDocId == null || e.targetNodeId == null) continue;
    if (e.status !== "resolved" && e.status !== "type-mismatch") continue;
    const region = byDoc.get(e.targetDocId);
    if (region && withinRegion(e.targetNodeId, region.regions)) {
      e.status = "type-mismatch";
      e.targetType = region.label;
    }
  }
}

const entryError = (): string =>
  "The entry document is a fragment whose root type could not be determined: no reference points at " +
  "its root. Load a complete OpenAPI or JSON Schema document as the entry, or a document that " +
  "references this fragment.";

const rootMissError = (frag: OadDocument): string =>
  `Document "${frag.filename ?? frag.retrievalUri ?? frag.id}" is a fragment with no reference to its ` +
  `root. Set fragment loading to "any" to type it from interior references, or load it as a complete ` +
  `OpenAPI or JSON Schema document.`;

/** Index a tree's nodes by JSON-Pointer id. */
function indexNodes(root: TreeNode): Map<string, TreeNode> {
  const index = new Map<string, TreeNode>();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    index.set(node.id, node);
    for (const child of node.children) stack.push(child);
  }
  return index;
}

/** JSON-Pointer depth: the root "" is 0, "/a" is 1, "/a/b" is 2. */
function depthOf(nodeId: string): number {
  return nodeId === "" ? 0 : nodeId.split("/").length - 1;
}

/** Whether `nodeId` is at or under one of the region roots (the empty region root covers everything). */
function withinRegion(nodeId: string, regions: string[]): boolean {
  return regions.some((r) => nodeId === r || nodeId.startsWith(`${r}/`));
}

/** Drop any id that lies within another id's subtree, leaving only the outermost region roots. */
function outermost(ids: string[]): string[] {
  return ids.filter((id) => !ids.some((other) => other !== id && (id === other || id.startsWith(`${other}/`))));
}

/** A stable string for an anchor set, to detect the fixpoint reaching a fixed point. */
function signatureOf(anchorsByDoc: Map<string, AnchorMap>): string {
  return [...anchorsByDoc]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([docId, anchors]) => {
      const inner = [...anchors]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([nodeId, a]) => `${nodeId}=${[...a.types].sort().join(",")}`)
        .join(";");
      return `${docId}:${inner}`;
    })
    .join("|");
}
