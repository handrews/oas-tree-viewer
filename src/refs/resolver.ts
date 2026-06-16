// Resolve every reference in an OAD into a ReferenceEdge.
//
// References handled: `$ref` in Reference / Path Item / Schema objects, and `operationRef`
// in Link objects. Resolution is JSON-Schema-correct: documents and `$id`-bearing schemas
// are both resources identified by a base URI; nested `$id` re-scopes the base, and a
// target is located by (resource URI) + (JSON Pointer or `$anchor`/plain-name fragment).

import type { Oad, OadDocument, TreeNode } from "../types";
import type { ReferenceEdge, RefContext, ResolvedRefs } from "./types";
import { refKey } from "./types";
import { decodeFragment, normalizeUri, resolveUri, splitFragment } from "./baseUri";

interface Resource {
  rootNode: TreeNode;
  doc: OadDocument;
}

interface RefSource {
  doc: OadDocument;
  sourceObject: TreeNode;
  fieldNode: TreeNode;
  refString: string;
  base: string;
  context: RefContext;
  kind: "$ref" | "operationRef";
  requiredType: string;
}

interface Indexes {
  pointerIndex: Map<string, Map<string, TreeNode>>; // docId -> (pointer -> node)
  resourceByUri: Map<string, Resource>;
  anchorByUri: Map<string, TreeNode>;
}

export function resolveOad(oad: Oad): ResolvedRefs {
  const indexes: Indexes = {
    pointerIndex: new Map(),
    resourceByUri: new Map(),
    anchorByUri: new Map(),
  };
  const sources: RefSource[] = [];

  // Pass 1: index all documents (so cross-document targets are known) and collect sources.
  for (const doc of oad.documents) {
    const pidx = new Map<string, TreeNode>();
    indexes.pointerIndex.set(doc.id, pidx);
    indexDocResource(doc, indexes);
    walkDoc(doc, pidx, indexes, sources);
  }

  // Pass 2: resolve.
  const edges = sources.map((src, i) => resolveSource(src, indexes, i));

  const bySource = new Map<string, ReferenceEdge[]>();
  const byTarget = new Map<string, ReferenceEdge[]>();
  for (const edge of edges) {
    push(bySource, refKey(edge.sourceDocId, edge.sourceNodeId), edge);
    if (edge.sourceObjectId !== edge.sourceNodeId) {
      push(bySource, refKey(edge.sourceDocId, edge.sourceObjectId), edge);
    }
    if (edge.targetDocId && edge.targetNodeId) {
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
): void {
  const visit = (node: TreeNode, currentBase: string): void => {
    pidx.set(node.id, node);
    let base = currentBase;

    if (node.oasType === "Schema Object") {
      const id = childString(node, "$id");
      if (id !== undefined) {
        base = resolveUri(id, currentBase) ?? currentBase;
        indexes.resourceByUri.set(base, { rootNode: node, doc });
      }
      const anchor = childString(node, "$anchor");
      if (anchor !== undefined) indexes.anchorByUri.set(`${base}#${anchor}`, node);
    }

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
      const field = childByKey(node, "operationRef");
      if (field && field.valueKind === "string") {
        sources.push({
          doc,
          sourceObject: node,
          fieldNode: field,
          refString: field.scalarValue as string,
          base,
          context: "link",
          kind: "operationRef",
          requiredType: "Operation",
        });
      }
    }

    for (const child of node.children) visit(child, base);
  };

  visit(doc.root, docBase(doc));
}

// ── resolution ───────────────────────────────────────────────────────────────

function resolveSource(src: RefSource, indexes: Indexes, i: number): ReferenceEdge {
  const edge: ReferenceEdge = {
    id: `edge-${i}`,
    sourceDocId: src.doc.id,
    sourceNodeId: src.fieldNode.id,
    sourceObjectId: src.sourceObject.id,
    refString: src.refString,
    kind: src.kind,
    context: src.context,
    status: "external",
    requiredType: src.requiredType,
  };

  const { uriPart, fragment } = splitFragment(src.refString);
  const resourceUri = uriPart === "" ? src.base : resolveUri(uriPart, src.base);
  if (!resourceUri) return edge; // cannot resolve → external

  edge.resolvedUri = withFragment(resourceUri, fragment);

  const resource = indexes.resourceByUri.get(resourceUri);
  if (!resource) return edge; // target resource not loaded → external

  edge.targetDocId = resource.doc.id;

  const target = resolveFragment(fragment, resource, resourceUri, indexes);
  if (!target) {
    edge.status = "broken";
    return edge;
  }

  edge.targetNodeId = target.id;
  edge.targetType = target.expectedType;

  const typeOk =
    target.expectedType === undefined ||
    src.requiredType === "" ||
    target.expectedType === src.requiredType;
  edge.status = typeOk ? "resolved" : "type-mismatch";
  return edge;
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

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
