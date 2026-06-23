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

import type { Oad, OadDocument, ResolutionAdvisory, TreeNode, VersionFamily } from "../types";
import type { ReferenceEdge, RefContext, RefStatus, ResolvedRefs } from "./types";
import { refKey } from "./types";
import { type ViewerConfig, defaultConfig } from "../app/config";
import { annotateDiagnostics } from "./diagnostics";
import { analyzeDynamicScope } from "./dynamicScope";
import type { AnchorRef, DynamicScopeAnalysis } from "./dynamicScope";
import { decodeFragment, normalizeUri, resolveUri, splitFragment } from "./baseUri";
import { dynamicScopeKeywords, idKeyword, referenceModel } from "../oas/dialects";

/**
 * The anonymous name under which a 2019-09 `$recursiveAnchor: true` is tracked for strict-winner
 * analysis. It lives ONLY in name-keyed structures (`dynamicAnchorsByName`, `anchorsByName`) and the
 * `recursiveAnchorResources` set — never in a `${base}#${name}` URI map — so the anonymous anchor can
 * never surface as a spurious URI fragment. The leading `$` also makes it an impossible anchor name.
 */
const RECURSIVE_SENTINEL = "$recursive";

interface Resource {
  rootNode: TreeNode;
  doc: OadDocument;
}

/** A component-or-URI reference field (Discriminator `mapping` value / Security Requirement key). */
interface ComponentSpec {
  expectedType: "Schema" | "SecurityScheme";
  field: "mapping" | "securityRequirement";
}

interface RefSource {
  doc: OadDocument;
  sourceObject: TreeNode;
  fieldNode: TreeNode;
  refString: string;
  base: string;
  context: RefContext;
  kind: ReferenceEdge["kind"];
  requiredType: string;
  /** Present for component-or-URI reference fields; absent for plain `$ref`/`operationRef`. */
  component?: ComponentSpec;
}

interface Indexes {
  pointerIndex: Map<string, Map<string, TreeNode>>; // docId -> (pointer -> node)
  resourceByUri: Map<string, Resource>;
  anchorByUri: Map<string, TreeNode>; // `${base}#${name}` -> node ($anchor AND $dynamicAnchor)
  dynamicAnchorByUri: Map<string, TreeNode>; // `${base}#${name}` -> node ($dynamicAnchor only)
  dynamicAnchorsByName: Map<string, Array<{ docId: string; node: TreeNode }>>; // every $dynamicAnchor
  resourceOf: Map<string, Map<string, string>>; // docId -> (nodeId -> the resource base URI it belongs to)
  recursiveAnchorResources: Set<string>; // base URIs whose root has 2019-09 `$recursiveAnchor: true`
}

/** Per-resolution context for the version- and config-dependent component rules. */
interface ResolveCtx {
  entryDocId: string;
  config: ViewerConfig;
  version: VersionFamily;
}

/** A located (or not) URI-reference target. */
interface UriResult {
  status: RefStatus;
  targetDocId?: string;
  targetNodeId?: string;
  targetType?: string;
  resolvedUri?: string;
}

/** A Link Object that targets an Operation by `operationId` (not a URI). */
interface OpIdSource {
  doc: OadDocument;
  linkNode: TreeNode;
  fieldNode: TreeNode;
  operationId: string;
}

/** A lexical-descent transition into a nested `$id` resource (gated by reachability later). */
interface DescentEdge {
  from: string;
  to: string;
  docId: string;
  nodeId: string;
}

/** A Schema with a `$dynamicRef` — resolved after the URI edges (so the anchor maps exist). */
interface DynRefSource {
  doc: OadDocument;
  schemaNode: TreeNode;
  fieldNode: TreeNode;
  refString: string;
  base: string;
}

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
    walkDoc(doc, pidx, indexes, sources, opIdSources, dynRefSources, recursiveRefSources, descentEdges, oad.versionFamily);
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
    if (reachableNodeSet.has(nodeKey(d.docId, d.nodeId))) resourceEdges.push({ from: d.from, to: d.to });
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

// ── indexing ────────────────────────────────────────────────────────────────

/** A document's canonical base URI: `$self` (resolved) → retrieval URI → synthetic urn. */
function docBase(doc: OadDocument): string {
  if (doc.selfUri) {
    const resolved = resolveUri(doc.selfUri, doc.retrievalUri);
    if (resolved) return resolved;
  }
  if (doc.retrievalUri) return normalizeUri(doc.retrievalUri);
  return `urn:oad:${doc.id}`;
}

function indexDocResource(doc: OadDocument, indexes: Indexes): void {
  const resource: Resource = { rootNode: doc.root, doc };
  indexes.resourceByUri.set(docBase(doc), resource);
  if (doc.retrievalUri) indexes.resourceByUri.set(normalizeUri(doc.retrievalUri), resource);
  if (doc.selfUri) {
    const self = resolveUri(doc.selfUri, doc.retrievalUri);
    if (self) indexes.resourceByUri.set(self, resource);
  }
}

function walkDoc(
  doc: OadDocument,
  pidx: Map<string, TreeNode>,
  indexes: Indexes,
  sources: RefSource[],
  opIdSources: OpIdSource[],
  dynRefSources: DynRefSource[],
  recursiveRefSources: DynRefSource[],
  descentEdges: Array<DescentEdge>,
  version: VersionFamily,
): void {
  const ridx = indexes.resourceOf.get(doc.id)!;
  // The document's default dialect (its `jsonSchemaDialect`, else undefined ⇒ the OAS dialect), which
  // each Schema Object inherits — and so its referencing model + identifier keyword — until one
  // re-declares the dialect via `$schema`.
  const docDialect = childString(doc.root, "jsonSchemaDialect");
  // `inDefs` tracks whether the path from the enclosing resource's root to here passes through a
  // definitions store (`$defs`/`definitions`/`components`) — i.e. content that is merely *defined*
  // (reached only by a reference), not *applied*. A nested `$id` resource reached without crossing
  // one is descent-reachable; one inside a defs store is not.
  const visit = (
    node: TreeNode,
    currentBase: string,
    inDefs: boolean,
    currentDialect: string | undefined,
    resourceRootId: string,
  ): void => {
    pidx.set(node.id, node);
    let base = currentBase;
    let childrenInDefs = inDefs;
    let dialect = currentDialect;
    let rootId = resourceRootId;

    if (node.oasType === "Schema Object") {
      // A `$schema` re-declares the dialect — and so the referencing model + identifier keyword —
      // for this subtree.
      const schema = childString(node, "$schema");
      if (schema !== undefined) dialect = schema;
      const model = referenceModel(dialect, version);
      const idKey = idKeyword(dialect, version);

      const id = childString(node, idKey);
      if (id !== undefined && model === "numbered-draft") {
        // draft-04/06/07: the non-fragment part sets the base; the fragment, if any, is either a
        // plain-name anchor (like a 2020-12 `$anchor`) or a JSON-Pointer that must be this schema's
        // own location. `$anchor`/`$dynamicAnchor`/`$dynamicRef` don't exist in this model.
        const { uriPart, fragment } = splitFragment(id);
        const newBase = (uriPart === "" ? currentBase : resolveUri(uriPart, currentBase)) ?? currentBase;
        if (newBase !== currentBase) {
          if (!inDefs) descentEdges.push({ from: currentBase, to: newBase, docId: doc.id, nodeId: node.id });
          childrenInDefs = false;
          indexes.resourceByUri.set(newBase, { rootNode: node, doc });
          base = newBase;
          rootId = node.id; // this node is the root of the new resource
        }
        if (fragment !== null) {
          const decoded = decodeFragment(fragment);
          if (decoded !== "" && !decoded.startsWith("/")) {
            indexes.anchorByUri.set(`${base}#${decoded}`, node); // plain-name fragment ⇒ anchor
          } else {
            // JSON-Pointer fragment (the empty fragment included): must point to this schema itself.
            const expected = node.id.slice(rootId.length);
            if (decoded !== expected) {
              addAdvisory(node, idKey, {
                code: "invalid-id-fragment",
                detail:
                  `The ${idKey} JSON-Pointer fragment "#${decoded}" is not this schema's own location ` +
                  `("#${expected}"), so it names nothing and is ignored.`,
              });
            }
          }
        }
      } else if (id !== undefined) {
        // 2020-12 / OAS / unsupported-fallback: a nested `$id` opens a new resource (unchanged).
        base = resolveUri(id, currentBase) ?? currentBase;
        // Evaluation can descend into this nested resource only when it is applied, not defined.
        if (!inDefs && base !== currentBase) {
          descentEdges.push({ from: currentBase, to: base, docId: doc.id, nodeId: node.id });
        }
        childrenInDefs = false; // a new resource subtree starts outside any enclosing defs store
        if (base !== currentBase) rootId = node.id;
        indexes.resourceByUri.set(base, { rootNode: node, doc });
      }

      if (model !== "numbered-draft") {
        // `$anchor` (named, 2019-09+) is shared across the date-formatted drafts; the numbered drafts
        // handled above have no counterpart (anchors come from `$id`).
        const anchor = childString(node, "$anchor");
        if (anchor !== undefined) indexes.anchorByUri.set(`${base}#${anchor}`, node);

        if (dynamicScopeKeywords(dialect, version) === "recursive") {
          // 2019-09: `$recursiveAnchor: true` is an ANONYMOUS dynamic anchor. It is tracked only by
          // the sentinel name and as a recursive-anchored resource — never in a `${base}#…` map — so
          // it can't be reached by `$ref` and can't surface as a spurious URI fragment.
          if (childBool(node, "$recursiveAnchor") === true) {
            indexes.recursiveAnchorResources.add(base);
            push(indexes.dynamicAnchorsByName, RECURSIVE_SENTINEL, { docId: doc.id, node });
          }
          const recRefField = childByKey(node, "$recursiveRef");
          if (recRefField && recRefField.valueKind === "string") {
            recursiveRefSources.push({
              doc,
              schemaNode: node,
              fieldNode: recRefField,
              refString: recRefField.scalarValue as string,
              base,
            });
          }
        } else {
          // 2020-12 / OAS (and the unsupported best-effort fallback): `$dynamicAnchor`/`$dynamicRef`.
          // A `$dynamicAnchor` is also a plain anchor (so `$ref` and a static `$dynamicRef` find it),
          // and additionally a dynamic-scope anchor (so a dynamic `$dynamicRef` can fan out to every
          // same-named one).
          const dynAnchor = childString(node, "$dynamicAnchor");
          if (dynAnchor !== undefined) {
            const key = `${base}#${dynAnchor}`;
            if (!indexes.anchorByUri.has(key)) indexes.anchorByUri.set(key, node);
            indexes.dynamicAnchorByUri.set(key, node);
            push(indexes.dynamicAnchorsByName, dynAnchor, { docId: doc.id, node });
          }
          // `$dynamicRef`: a schema-only reference whose target depends on the evaluation path.
          const dynRefField = childByKey(node, "$dynamicRef");
          if (dynRefField && dynRefField.valueKind === "string") {
            dynRefSources.push({
              doc,
              schemaNode: node,
              fieldNode: dynRefField,
              refString: dynRefField.scalarValue as string,
              base,
            });
          }
        }
      }

      // draft-04/06/07 ignore every keyword beside `$ref`; warn when a `$ref` schema carries siblings.
      // The advisory describes the whole schema, so it rides on the Schema Object node itself.
      if (model === "numbered-draft" && node.isReference) {
        const ignored = node.children
          .map((c) => c.key)
          .filter((k): k is string => k !== null && k !== "$ref");
        if (ignored.length) {
          (node.resolutionAdvisories ??= []).push({
            code: "ignored-ref-siblings",
            detail: `In draft-04/06/07, keywords beside $ref are ignored: ${ignored.join(", ")}.`,
          });
        }
      }
    }

    // Record which resource this node belongs to (an `$id` node belongs to its own new resource).
    ridx.set(node.id, base);

    if (node.isReference && node.refTarget !== undefined) {
      const field = childByKey(node, "$ref");
      if (field) {
        sources.push({
          doc,
          sourceObject: node,
          fieldNode: field,
          refString: node.refTarget,
          base,
          context: contextOf(node),
          kind: "$ref",
          requiredType: node.expectedType ?? "",
        });
      }
    } else if (node.oasType === "Link Object") {
      // A Link uses exactly one of `operationRef` / `operationId` (setting both is rejected at
      // load time, so it never reaches here). `operationRef` is a URI; `operationId` resolves
      // against the global Operation index in pass 2.
      const refField = childByKey(node, "operationRef");
      const idField = childByKey(node, "operationId");
      if (refField && refField.valueKind === "string") {
        sources.push({
          doc,
          sourceObject: node,
          fieldNode: refField,
          refString: refField.scalarValue as string,
          base,
          context: "link",
          kind: "operationRef",
          requiredType: "Operation",
        });
      } else if (idField && idField.valueKind === "string") {
        opIdSources.push({
          doc,
          linkNode: node,
          fieldNode: idField,
          operationId: idField.scalarValue as string,
        });
      }
    }

    // Component-or-URI reference fields (Discriminator `mapping` value / Security Requirement key).
    if (node.componentRef) {
      const cr = node.componentRef;
      sources.push({
        doc,
        sourceObject: node,
        fieldNode: node,
        refString: cr.refString,
        base,
        context: cr.field === "mapping" ? "discriminatorMapping" : "securityRequirement",
        kind: cr.field === "mapping" ? "discriminatorMapping" : "securityRequirement",
        requiredType: cr.expectedType,
        component: { expectedType: cr.expectedType, field: cr.field },
      });
    }

    for (const child of node.children) {
      visit(child, base, childrenInDefs || isDefsBoundary(child), dialect, rootId);
    }
  };

  visit(doc.root, docBase(doc), false, docDialect, doc.root.id);
}

/** Keys whose subtree holds schemas that are *defined* (reached only by a reference), not applied. */
function isDefsBoundary(node: TreeNode): boolean {
  return node.key === "$defs" || node.key === "definitions" || node.key === "components";
}

// ── resolution ───────────────────────────────────────────────────────────────

function resolveSource(src: RefSource, indexes: Indexes, i: number, ctx: ResolveCtx): ReferenceEdge {
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

/** Index every Operation by its `operationId` (unique across the OAD — `assembleOad` guards). */
function buildOperationIdIndex(
  pointerIndex: Map<string, Map<string, TreeNode>>,
): Map<string, { docId: string; node: TreeNode }> {
  const index = new Map<string, { docId: string; node: TreeNode }>();
  for (const [docId, pidx] of pointerIndex) {
    for (const node of pidx.values()) {
      if (node.oasType !== "Operation Object") continue;
      const operationId = childString(node, "operationId");
      if (operationId !== undefined && !index.has(operationId)) index.set(operationId, { docId, node });
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
  return { recursive: !!resourceUri && atResourceRoot && recursiveAnchorResources.has(resourceUri) };
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

/** Key into the node-reachability set. */
function nodeKey(docId: string, nodeId: string): string {
  return `${docId} ${nodeId}`;
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
    (refAdj.get(k) ?? refAdj.set(k, []).get(k)!).push({ docId: e.targetDocId, nodeId: e.targetNodeId });
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

/** Tag every `$dynamicAnchor` with the resource that declares it, grouped by name. */
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

/** Resolve a string as a URI-reference (the `$ref`/`operationRef` path; reused by components). */
function resolveUriRef(
  refString: string,
  base: string,
  requiredType: string,
  indexes: Indexes,
): UriResult {
  const { uriPart, fragment } = splitFragment(refString);
  const resourceUri = uriPart === "" ? base : resolveUri(uriPart, base);
  if (!resourceUri) return { status: "external" };

  const resolvedUri = withFragment(resourceUri, fragment);
  const resource = indexes.resourceByUri.get(resourceUri);
  if (!resource) return { status: "external", resolvedUri };

  const target = resolveFragment(fragment, resource, resourceUri, indexes);
  if (!target) return { status: "broken", targetDocId: resource.doc.id, resolvedUri };

  const typeOk =
    target.expectedType === undefined || requiredType === "" || target.expectedType === requiredType;
  return {
    status: typeOk ? "resolved" : "type-mismatch",
    targetDocId: resource.doc.id,
    targetNodeId: target.id,
    targetType: target.expectedType,
    resolvedUri,
  };
}

/**
 * Resolve a Discriminator `mapping` value / Security Requirement key, which is either a
 * component name or a URI-reference. Precedence (confirmed rules):
 *  - Security Requirement, 3.1: always a component name (no URI fallback).
 *  - Security Requirement, 3.2: component name if a match exists, else URI-reference.
 *  - `mapping`, name-first (default): component name if a match exists, else URI-reference.
 *  - `mapping`, uri-first (config): URI-reference if it locates a target, else component name.
 * The "match" is looked up in the entry document's Components (default) or the local doc's.
 */
function resolveComponentEdge(
  base: ReferenceEdge,
  src: RefSource,
  spec: ComponentSpec,
  indexes: Indexes,
  ctx: ResolveCtx,
): ReferenceEdge {
  const key = spec.expectedType === "Schema" ? "schemas" : "securitySchemes";
  const lookupDocId = ctx.config.componentLookup === "entry" ? ctx.entryDocId : src.doc.id;
  const nameTarget = indexes.pointerIndex
    .get(lookupDocId)
    ?.get(`/components/${key}/${src.refString}`);

  const asName = (): ReferenceEdge =>
    nameTarget
      ? {
          ...base,
          resolution: "component-name",
          status: "resolved", // the component's location guarantees its type
          targetDocId: lookupDocId,
          targetNodeId: nameTarget.id,
          targetType: spec.expectedType,
        }
      : { ...base, resolution: "component-name", status: "broken" };

  const asUri = (): ReferenceEdge => ({
    ...base,
    resolution: "uri-reference",
    ...resolveUriRef(src.refString, src.base, spec.expectedType, indexes),
  });

  if (spec.field === "securityRequirement") {
    if (ctx.version === "3.1") return asName();
    return nameTarget ? asName() : asUri();
  }

  // Discriminator mapping.
  if (ctx.config.mappingPrecedence === "name-first") {
    return nameTarget ? asName() : asUri();
  }
  // uri-first: a URI-reference wins if it locates a target; otherwise fall back to the name.
  const uri = asUri();
  if (uri.status === "resolved" || uri.status === "type-mismatch") return uri;
  return nameTarget ? asName() : uri;
}

function resolveFragment(
  fragment: string | null,
  resource: Resource,
  resourceUri: string,
  indexes: Indexes,
): TreeNode | undefined {
  if (fragment === null || fragment === "") return resource.rootNode;

  const decoded = decodeFragment(fragment);
  if (decoded.startsWith("/")) {
    // JSON Pointer relative to the resource root node.
    const pointer = resource.rootNode.id + decoded;
    return indexes.pointerIndex.get(resource.doc.id)?.get(pointer);
  }
  // Plain-name / $anchor fragment.
  return indexes.anchorByUri.get(`${resourceUri}#${decoded}`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function contextOf(node: TreeNode): RefContext {
  if (node.expectedType === "Schema") return "schema";
  if (node.expectedType === "PathItem") return "pathItem";
  return "reference";
}

function withFragment(uri: string, fragment: string | null): string {
  return fragment === null ? uri : `${uri}#${fragment}`;
}

function childByKey(node: TreeNode, key: string): TreeNode | undefined {
  return node.children.find((c) => c.key === key);
}

function childString(node: TreeNode, key: string): string | undefined {
  const child = childByKey(node, key);
  return child && child.valueKind === "string" ? (child.scalarValue as string) : undefined;
}

function childBool(node: TreeNode, key: string): boolean | undefined {
  const child = childByKey(node, key);
  return child && child.valueKind === "boolean" ? (child.scalarValue as boolean) : undefined;
}

/** Attach a resolution advisory to a Schema Object's `$ref`/`$id` field row (or the schema itself). */
function addAdvisory(schemaNode: TreeNode, childKey: string, advisory: ResolutionAdvisory): void {
  const target = childByKey(schemaNode, childKey) ?? schemaNode;
  (target.resolutionAdvisories ??= []).push(advisory);
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
