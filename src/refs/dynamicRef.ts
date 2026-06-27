// Classify and resolve `$dynamicRef` (2020-12) and `$recursiveRef` (2019-09). Each is either a plain
// static reference or, when it engages dynamic/recursive scope, a tentative (dotted) fan-out to the
// "strict winners" computed by the dynamic-scope analysis.

import type { TreeNode } from "../types";
import type { ReferenceEdge } from "./types";
import { decodeFragment, resolveUri, splitFragment } from "./baseUri";
import type { DynamicScopeAnalysis } from "./dynamicScope";
import { RECURSIVE_SENTINEL, type DynRefSource, type Indexes } from "./indexer";
import { resolveUriRef } from "./uriRef";

/**
 * Classify a `$dynamicRef`: it engages dynamic scope ("bookending") iff its statically-located
 * fragment is itself a `$dynamicAnchor` (a plain name registered in `dynamicAnchorByUri`). Otherwise
 * it resolves exactly like a `$ref` — the local `$anchor` (Case A), a JSON-Pointer target, or broken.
 */
export function classifyDynamicRef(
  refString: string,
  base: string,
  dynamicAnchorByUri: Map<string, TreeNode>,
): { dynamic: true; name: string } | { dynamic: false } {
  const { uriPart, fragment } = splitFragment(refString);
  const resourceUri = uriPart === "" ? base : resolveUri(uriPart, base);
  const decoded = fragment !== null ? decodeFragment(fragment) : null;
  const isPlainName = decoded !== null && decoded !== "" && !decoded.startsWith("/");
  if (resourceUri && isPlainName && dynamicAnchorByUri.has(`${resourceUri}#${decoded}`)) {
    return { dynamic: true, name: decoded };
  }
  return { dynamic: false };
}

/**
 * Resolve a Schema `$dynamicRef`. If it engages dynamic scope, the real target depends on the
 * evaluation path — so we tentatively point (resolution `"dynamic"`, drawn dotted) at the *strict
 * winners*: the same-named `$dynamicAnchor`s that could be the outermost one on an entry-rooted path
 * reaching this ref (computed by {@link analyzeDynamicScope}). A ref the entry never reaches yields
 * no edges. Otherwise it behaves exactly like a `$ref`: a single static edge (the local `$anchor` —
 * Case A — or broken). A plain `$ref` landing on a `$dynamicAnchor` (Case B) is handled by the
 * normal URI path, since `$dynamicAnchor`s are also registered in `anchorByUri`.
 */
export function resolveDynamicRef(
  src: DynRefSource,
  indexes: Indexes,
  analysis: DynamicScopeAnalysis,
  nextId: () => string,
): ReferenceEdge[] {
  const makeEdge = (overrides: Partial<ReferenceEdge>): ReferenceEdge => ({
    id: nextId(),
    sourceDocId: src.doc.id,
    sourceNodeId: src.fieldNode.id,
    sourceObjectId: src.schemaNode.id,
    refString: src.refString,
    kind: "$dynamicRef",
    context: "schema",
    resolution: "uri-reference",
    status: "external",
    requiredType: "Schema",
    ...overrides,
  });

  const classified = classifyDynamicRef(src.refString, src.base, indexes.dynamicAnchorByUri);
  if (classified.dynamic) {
    src.fieldNode.resolvedAs = "dynamic";
    return analysis.winners(src.base, classified.name).map((t) =>
      makeEdge({
        resolution: "dynamic",
        status: "resolved",
        targetDocId: t.docId,
        targetNodeId: t.node.id,
        targetType: t.node.expectedType,
      }),
    );
  }

  // Static: exactly like a `$ref` (Case A local `$anchor`, Case B `$dynamicAnchor`, or broken).
  src.fieldNode.resolvedAs = "uri-reference";
  return [makeEdge(resolveUriRef(src.refString, src.base, "Schema", indexes))];
}

/**
 * Classify a 2019-09 `$recursiveRef` (almost always `"#"`): it engages recursive scope iff it
 * statically resolves to a schema *resource root* (empty/null fragment) whose resource declares
 * `$recursiveAnchor: true`. Otherwise it is a plain static `$ref` to that target.
 */
export function classifyRecursiveRef(
  refString: string,
  base: string,
  recursiveAnchorResources: Set<string>,
): { recursive: boolean } {
  const { uriPart, fragment } = splitFragment(refString);
  const resourceUri = uriPart === "" ? base : resolveUri(uriPart, base);
  const atResourceRoot = fragment === null || fragment === "";
  return {
    recursive: !!resourceUri && atResourceRoot && recursiveAnchorResources.has(resourceUri),
  };
}

/**
 * Resolve a `$recursiveRef`. If it engages recursive scope, point tentatively (dotted) at the strict
 * winners — the outermost `$recursiveAnchor: true` resources on an entry-rooted path reaching it
 * (the anonymous {@link RECURSIVE_SENTINEL} fan-out). Otherwise it behaves like a static `$ref` to
 * `"#"` (the resource root).
 */
export function resolveRecursiveRef(
  src: DynRefSource,
  indexes: Indexes,
  analysis: DynamicScopeAnalysis,
  nextId: () => string,
): ReferenceEdge[] {
  const makeEdge = (overrides: Partial<ReferenceEdge>): ReferenceEdge => ({
    id: nextId(),
    sourceDocId: src.doc.id,
    sourceNodeId: src.fieldNode.id,
    sourceObjectId: src.schemaNode.id,
    refString: src.refString,
    kind: "$recursiveRef",
    context: "schema",
    resolution: "uri-reference",
    status: "external",
    requiredType: "Schema",
    ...overrides,
  });

  if (classifyRecursiveRef(src.refString, src.base, indexes.recursiveAnchorResources).recursive) {
    src.fieldNode.resolvedAs = "dynamic";
    return analysis.winners(src.base, RECURSIVE_SENTINEL).map((t) =>
      makeEdge({
        resolution: "dynamic",
        status: "resolved",
        targetDocId: t.docId,
        targetNodeId: t.node.id,
        targetType: t.node.expectedType,
      }),
    );
  }

  // Static: a plain `$ref` to its target (`"#"` ⇒ the resource root).
  src.fieldNode.resolvedAs = "uri-reference";
  return [makeEdge(resolveUriRef(src.refString, src.base, "Schema", indexes))];
}
