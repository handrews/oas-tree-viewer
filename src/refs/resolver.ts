import type { Oad, OadDocument, TreeNode } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "./types";
import { refKey } from "./types";
import { type ViewerConfig, defaultConfig } from "../app/config";
import { annotateDiagnostics } from "./diagnostics";
import { analyzeDynamicScope } from "./dynamicScope";
import type { AnchorRef, DynamicScopeAnalysis } from "./dynamicScope";
import { decodeFragment, resolveUri, splitFragment } from "./baseUri";
import {
  RECURSIVE_SENTINEL,
  childString,
  docBase,
  indexDocResource,
  isDefsBoundary,
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
  const descentEdges: Array<DescentEdge> = [];

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

  const edges = sources.map((src, i) => resolveSource(src, indexes, i, ctx));
  const opIndex = buildOperationIdIndex(indexes.pointerIndex);
  opIdSources.forEach((src, j) => {
    edges.push(resolveOperationId(src, opIndex, `edge-${sources.length + j}`));
  });

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

  annotateDiagnostics(oad, edges, indexes.pointerIndex);

  const bySource = new Map<string, ReferenceEdge[]>();
  const byTarget = new Map<string, ReferenceEdge[]>();
  for (const edge of edges) {
    push(bySource, refKey(edge.sourceDocId, edge.sourceNodeId), edge);
    if (edge.sourceObjectId !== edge.sourceNodeId) {
      push(bySource, refKey(edge.sourceDocId, edge.sourceObjectId), edge);
    }
    if (edge.targetDocId != null && edge.targetNodeId != null) {
      push(byTarget, refKey(edge.targetDocId, edge.targetNodeId), edge);
    }
  }

  return { edges, bySource, byTarget };
}

// ── resolution ───────────────────────────────────────────────────────────────

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

  src.fieldNode.resolvedAs = edge.resolution;
  return edge;
}

/** Index every Operation by its `operationId` (unique across the OAD — `assembleOad` guards). */
function buildOperationIdIndex(
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
function resolveOperationId(
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

/**
 * Classify a `$dynamicRef`: it engages dynamic scope ("bookending") iff its statically-located
 * fragment is itself a `$dynamicAnchor` (a plain name registered in `dynamicAnchorByUri`). Otherwise
 * it resolves exactly like a `$ref` — the local `$anchor` (Case A), a JSON-Pointer target, or broken.
 */
function classifyDynamicRef(
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
function resolveDynamicRef(
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
function classifyRecursiveRef(
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
function resolveRecursiveRef(
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

function nodeKey(docId: string, nodeId: string): string {
  return `${docId} ${nodeId}`;
}

/**
 * The nodes actually *evaluated* on some entry-rooted path: descend from the entry root through
 * applied positions (everything except definition stores — `$defs`/`definitions`/`components`,
 * skipped by {@link isDefsBoundary}) and follow located references. A component buried in a defs
 * store is reached only if something references it; an unreferenced one is never evaluated, so its
 * own references must not contribute dynamic-scope transitions.
 */
function reachableNodes(
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
function buildResourceEdges(
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

function buildAnchorsByName(
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
