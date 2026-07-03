// Resolve every reference in an OAD into a ReferenceEdge.
//
// References handled:
//  - `$ref` in Reference / Path Item / Schema objects, and `operationRef` in Link objects
//    — always URI-references (JSON-Schema-correct: documents and `$id`-bearing schemas are
//    resources identified by a base URI; nested `$id` re-scopes; a target is located by
//    (resource URI) + (JSON Pointer or `$anchor`/plain-name fragment)).
//  - Discriminator `mapping` values (→ Schema) and Security Requirement keys (→ Security
//    Scheme) — each a string that resolves either as a **component name** (a direct lookup
//    in a Components Object) or as a **URI-reference**, chosen per OAS version + config.

import type { Oad, TreeNode } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "./types";
import { refKey } from "./types";
import { type ViewerConfig, defaultConfig } from "../app/config";
import { annotateDiagnostics } from "./diagnostics";
import { analyzeDynamicScope } from "./dynamicScope";
import {
  RECURSIVE_SENTINEL,
  docBase,
  indexDocResource,
  push,
  walkDoc,
  type DescentEdge,
  type DynRefSource,
  type Indexes,
  type OpIdSource,
  type RefSource,
} from "./indexer";
import { resolveUriRef } from "./uriRef";
import { resolveComponentEdge, type ResolveCtx } from "./componentRef";
import { buildOperationIdIndex, resolveOperationId } from "./operationId";
import {
  classifyDynamicRef,
  classifyRecursiveRef,
  resolveDynamicRef,
  resolveRecursiveRef,
} from "./dynamicRef";
import { buildAnchorsByName, buildResourceEdges, nodeKey, reachableNodes } from "./scopeGraph";

export function resolveOad(oad: Oad, config: ViewerConfig = defaultConfig): ResolvedRefs {
  const indexes: Indexes = {
    pointerIndex: new Map(),
    resourceByUri: new Map(),
    anchorByUri: new Map(),
    dynamicAnchorByUri: new Map(),
    dynamicAnchorsByName: new Map(),
    resourceOf: new Map(),
    recursiveAnchorResources: new Set(),
  };
  const sources: RefSource[] = [];
  const opIdSources: OpIdSource[] = [];
  const dynRefSources: DynRefSource[] = [];
  const recursiveRefSources: DynRefSource[] = [];
  // Lexical-descent transitions: a parent resource → a nested `$id` resource that evaluation can
  // descend into (collected during the walk, excluding definition stores). Carries the nested
  // resource's root node so the transition can be gated by entry reachability later.
  const descentEdges: Array<DescentEdge> = [];

  // Pass 1: index all documents (so cross-document targets are known) and collect sources.
  for (const doc of oad.documents) {
    const pidx = new Map<string, TreeNode>();
    indexes.pointerIndex.set(doc.id, pidx);
    indexes.resourceOf.set(doc.id, new Map());
    indexDocResource(doc, indexes);
    walkDoc(
      doc,
      pidx,
      indexes,
      sources,
      opIdSources,
      dynRefSources,
      recursiveRefSources,
      descentEdges,
      oad.versionFamily,
    );
  }

  const entry = oad.documents.find((d) => d.isEntry) ?? oad.documents[0];
  const ctx: ResolveCtx = { entryDocId: entry?.id ?? "", config, version: oad.versionFamily };

  // Pass 2: resolve URI-references, then Link `operationId`s against a global Operation index
  // (unique by construction — `assembleOad` rejects duplicates). A match resolves as an
  // implicit `operation-id` connection; no match is broken.
  const edges = sources.map((src, i) => resolveSource(src, indexes, i, ctx));
  const opIndex = buildOperationIdIndex(indexes.pointerIndex);
  opIdSources.forEach((src, j) => {
    edges.push(resolveOperationId(src, opIndex, `edge-${sources.length + j}`));
  });

  // Pass 2b: resolve `$dynamicRef`s. A dynamic one's tentative targets are the "strict winners" —
  // the same-named `$dynamicAnchor`s that could be the *outermost* one in an entry-rooted dynamic
  // scope reaching this ref (see dynamicScope.ts). Build the resource graph from the located edges
  // resolved so far plus lexical descent, then narrow.
  const entryRoot = entry ? docBase(entry) : "";
  const reachableNodeSet = reachableNodes(entry, edges, indexes.pointerIndex);
  const resourceEdges = buildResourceEdges(edges, indexes.resourceOf, reachableNodeSet);
  for (const d of descentEdges) {
    if (reachableNodeSet.has(nodeKey(d.docId, d.nodeId)))
      resourceEdges.push({ from: d.from, to: d.to });
  }
  const anchorsByName = buildAnchorsByName(indexes.dynamicAnchorsByName, indexes.resourceOf);
  const dynamicRefDescriptors: Array<{ resourceUri: string; name: string }> = [];
  for (const src of dynRefSources) {
    const c = classifyDynamicRef(src.refString, src.base, indexes.dynamicAnchorByUri);
    if (c.dynamic) dynamicRefDescriptors.push({ resourceUri: src.base, name: c.name });
  }
  // A 2019-09 `$recursiveRef` that engages recursive scope fans out over the anonymous sentinel —
  // every `$recursiveAnchor: true` resource — exactly like a `$dynamicRef` over a named anchor.
  for (const src of recursiveRefSources) {
    if (classifyRecursiveRef(src.refString, src.base, indexes.recursiveAnchorResources).recursive) {
      dynamicRefDescriptors.push({ resourceUri: src.base, name: RECURSIVE_SENTINEL });
    }
  }
  const analysis = analyzeDynamicScope({
    entryRoot,
    resourceEdges,
    dynamicRefs: dynamicRefDescriptors,
    anchorsByName,
  });

  let edgeNo = edges.length;
  for (const src of dynRefSources) {
    for (const edge of resolveDynamicRef(src, indexes, analysis, () => `edge-${edgeNo++}`)) {
      edges.push(edge);
    }
  }
  for (const src of recursiveRefSources) {
    for (const edge of resolveRecursiveRef(src, indexes, analysis, () => `edge-${edgeNo++}`)) {
      edges.push(edge);
    }
  }

  // Pass 3: annotate resolved edges with semantic advisories (operation-target callability,
  // Path Item `$ref` field overlap). Resolved `operationId` edges are `requiredType ===
  // "Operation"`, so they pick up the callability advisories for free. Mutates in place.
  annotateDiagnostics(oad, edges, indexes.pointerIndex);

  const bySource = new Map<string, ReferenceEdge[]>();
  const byTarget = new Map<string, ReferenceEdge[]>();
  for (const edge of edges) {
    push(bySource, refKey(edge.sourceDocId, edge.sourceNodeId), edge);
    if (edge.sourceObjectId !== edge.sourceNodeId) {
      push(bySource, refKey(edge.sourceDocId, edge.sourceObjectId), edge);
    }
    // The root node's id is "" (falsy but valid), so test for presence explicitly.
    if (edge.targetDocId != null && edge.targetNodeId != null) {
      push(byTarget, refKey(edge.targetDocId, edge.targetNodeId), edge);
    }
  }

  return { edges, bySource, byTarget };
}

function resolveSource(
  src: RefSource,
  indexes: Indexes,
  i: number,
  ctx: ResolveCtx,
): ReferenceEdge {
  const base: ReferenceEdge = {
    id: `edge-${i}`,
    sourceDocId: src.doc.id,
    sourceNodeId: src.fieldNode.id,
    sourceObjectId: src.sourceObject.id,
    refString: src.refString,
    kind: src.kind,
    context: src.context,
    resolution: "uri-reference",
    status: "external",
    requiredType: src.requiredType,
  };

  const edge = src.component
    ? resolveComponentEdge(base, src, src.component, indexes, ctx)
    : { ...base, ...resolveUriRef(src.refString, src.base, src.requiredType, indexes) };

  // Record how this field resolved so the tree marker can reflect it (uri vs component-name).
  src.fieldNode.resolvedAs = edge.resolution;
  return edge;
}
