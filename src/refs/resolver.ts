import type { Oad, OadDocument, ResolutionAdvisory, TreeNode, VersionFamily } from "../types";
import type { ReferenceEdge, RefContext, ResolvedRefs } from "./types";
import { refKey } from "./types";
import { type ViewerConfig, defaultConfig } from "../app/config";
import { annotateDiagnostics } from "./diagnostics";
import { analyzeDynamicScope } from "./dynamicScope";
import { decodeFragment, resolveUri, splitFragment } from "./baseUri";
import { dynamicScopeKeywords, idKeyword, referenceModel } from "../oas/dialects";
import {
  childBool,
  childByKey,
  childString,
  docBase,
  indexDocResource,
  isDefsBoundary,
  nodeKey,
  push,
  resolveUriRef,
  type DescentEdge,
  type DynRefSource,
  type Indexes,
} from "./resolverShared";
import {
  classifyDynamicRef,
  classifyRecursiveRef,
  RECURSIVE_SENTINEL,
  resolveDynamicRef,
  resolveRecursiveRef,
} from "./resolverDynamic";
import { buildAnchorsByName, buildResourceEdges, reachableNodes } from "./resolverReachability";

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
  component?: ComponentSpec;
}

interface ResolveCtx {
  entryDocId: string;
  config: ViewerConfig;
  version: VersionFamily;
}

interface OpIdSource {
  doc: OadDocument;
  linkNode: TreeNode;
  fieldNode: TreeNode;
  operationId: string;
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

    if (node.oasType === "Schema Object" && version !== "3.0") {
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
        const newBase =
          (uriPart === "" ? currentBase : resolveUri(uriPart, currentBase)) ?? currentBase;
        if (newBase !== currentBase) {
          if (!inDefs)
            descentEdges.push({ from: currentBase, to: newBase, docId: doc.id, nodeId: node.id });
          childrenInDefs = false;
          indexes.resourceByUri.set(newBase, { rootNode: node, doc });
          base = newBase;
          rootId = node.id;
        }
        if (fragment !== null) {
          const decoded = decodeFragment(fragment);
          if (decoded !== "" && !decoded.startsWith("/")) {
            indexes.anchorByUri.set(`${base}#${decoded}`, node);
          } else {
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
        base = resolveUri(id, currentBase) ?? currentBase;
        // Evaluation can descend into this nested resource only when it is applied, not defined.
        if (!inDefs && base !== currentBase) {
          descentEdges.push({ from: currentBase, to: base, docId: doc.id, nodeId: node.id });
        }
        childrenInDefs = false;
        if (base !== currentBase) rootId = node.id;
        indexes.resourceByUri.set(base, { rootNode: node, doc });
      }

      if (model !== "numbered-draft") {
        const anchor = childString(node, "$anchor");
        if (anchor !== undefined) indexes.anchorByUri.set(`${base}#${anchor}`, node);

        if (dynamicScopeKeywords(dialect, version) === "recursive") {
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
          const dynAnchor = childString(node, "$dynamicAnchor");
          if (dynAnchor !== undefined) {
            const key = `${base}#${dynAnchor}`;
            if (!indexes.anchorByUri.has(key)) indexes.anchorByUri.set(key, node);
            indexes.dynamicAnchorByUri.set(key, node);
            push(indexes.dynamicAnchorsByName, dynAnchor, { docId: doc.id, node });
          }
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

  clearAdvisories(doc.root);
  visit(doc.root, docBase(doc), false, docDialect, doc.root.id);
}

function clearAdvisories(node: TreeNode): void {
  node.resolutionAdvisories = undefined;
  for (const child of node.children) clearAdvisories(child);
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

  src.fieldNode.resolvedAs = edge.resolution;
  return edge;
}

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
          status: "resolved",
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
    if (ctx.version !== "3.2") return asName();
    return nameTarget ? asName() : asUri();
  }

  if (ctx.config.mappingPrecedence === "name-first") {
    return nameTarget ? asName() : asUri();
  }
  const uri = asUri();
  if (uri.status === "resolved" || uri.status === "type-mismatch") return uri;
  return nameTarget ? asName() : uri;
}

function contextOf(node: TreeNode): RefContext {
  if (node.expectedType === "Schema") return "schema";
  if (node.expectedType === "PathItem") return "pathItem";
  return "reference";
}

function addAdvisory(schemaNode: TreeNode, childKey: string, advisory: ResolutionAdvisory): void {
  const target = childByKey(schemaNode, childKey) ?? schemaNode;
  (target.resolutionAdvisories ??= []).push(advisory);
}
