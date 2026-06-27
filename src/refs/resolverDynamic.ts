import type { TreeNode } from "../types";
import type { ReferenceEdge } from "./types";
import type { DynamicScopeAnalysis } from "./dynamicScope";
import { decodeFragment, resolveUri, splitFragment } from "./baseUri";
import type { DynRefSource, Indexes } from "./resolverShared";
import { resolveUriRef } from "./resolverShared";

// Anonymous 2019-09 recursive anchors must not be exposed as URI fragments.
export const RECURSIVE_SENTINEL = "$recursive";

// A `$dynamicRef` engages dynamic scope only when its static target is a `$dynamicAnchor`.
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

  src.fieldNode.resolvedAs = "uri-reference";
  return [makeEdge(resolveUriRef(src.refString, src.base, "Schema", indexes))];
}

// A 2019-09 `$recursiveRef` engages recursive scope only at a recursive-anchored resource root.
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

  src.fieldNode.resolvedAs = "uri-reference";
  return [makeEdge(resolveUriRef(src.refString, src.base, "Schema", indexes))];
}
