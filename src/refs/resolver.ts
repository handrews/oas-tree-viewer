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

import type { Oad, OadDocument, TreeNode, VersionFamily } from "../types";
import type { ReferenceEdge, RefContext, RefStatus, ResolvedRefs } from "./types";
import { refKey } from "./types";
import { type ViewerConfig, defaultConfig } from "../app/config";
import { annotateDiagnostics } from "./diagnostics";
import { decodeFragment, normalizeUri, resolveUri, splitFragment } from "./baseUri";

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
  anchorByUri: Map<string, TreeNode>;
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

export function resolveOad(oad: Oad, config: ViewerConfig = defaultConfig): ResolvedRefs {
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

  const entry = oad.documents.find((d) => d.isEntry) ?? oad.documents[0];
  const ctx: ResolveCtx = { entryDocId: entry?.id ?? "", config, version: oad.versionFamily };

  // Pass 2: resolve.
  const edges = sources.map((src, i) => resolveSource(src, indexes, i, ctx));

  // Pass 3: annotate resolved edges with semantic advisories (operation-target callability,
  // Path Item `$ref` field overlap). Mutates edge.diagnostics in place.
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

    for (const child of node.children) visit(child, base);
  };

  visit(doc.root, docBase(doc));
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

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
