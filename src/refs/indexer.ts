import type { OadDocument, ResolutionAdvisory, TreeNode, VersionFamily } from "../types";
import type { ReferenceEdge, RefContext } from "./types";
import { decodeFragment, normalizeUri, resolveUri, splitFragment } from "./baseUri";
import { dynamicScopeKeywords, idKeyword, referenceModel } from "../oas/dialects";

// Anonymous 2019-09 recursive anchors must not be exposed as URI fragments.
export const RECURSIVE_SENTINEL = "$recursive";

export interface Resource {
  rootNode: TreeNode;
  doc: OadDocument;
}

export interface ComponentSpec {
  expectedType: "Schema" | "SecurityScheme";
  field: "mapping" | "securityRequirement";
}

export interface RefSource {
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

export interface Indexes {
  pointerIndex: Map<string, Map<string, TreeNode>>;
  resourceByUri: Map<string, Resource>;
  anchorByUri: Map<string, TreeNode>;
  dynamicAnchorByUri: Map<string, TreeNode>;
  dynamicAnchorsByName: Map<string, Array<{ docId: string; node: TreeNode }>>;
  resourceOf: Map<string, Map<string, string>>;
  recursiveAnchorResources: Set<string>;
}

export interface OpIdSource {
  doc: OadDocument;
  linkNode: TreeNode;
  fieldNode: TreeNode;
  operationId: string;
}

export interface DescentEdge {
  from: string;
  to: string;
  docId: string;
  nodeId: string;
}

export interface DynRefSource {
  doc: OadDocument;
  schemaNode: TreeNode;
  fieldNode: TreeNode;
  refString: string;
  base: string;
}

export function docBase(doc: OadDocument): string {
  if (doc.selfUri) {
    const resolved = resolveUri(doc.selfUri, doc.retrievalUri);
    if (resolved) return resolved;
  }
  if (doc.retrievalUri) return normalizeUri(doc.retrievalUri);
  return `urn:oad:${doc.id}`;
}

export function indexDocResource(doc: OadDocument, indexes: Indexes): void {
  const resource: Resource = { rootNode: doc.root, doc };
  indexes.resourceByUri.set(docBase(doc), resource);
  if (doc.retrievalUri) indexes.resourceByUri.set(normalizeUri(doc.retrievalUri), resource);
  if (doc.selfUri) {
    const self = resolveUri(doc.selfUri, doc.retrievalUri);
    if (self) indexes.resourceByUri.set(self, resource);
  }
}

export function walkDoc(
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

export function isDefsBoundary(node: TreeNode): boolean {
  return node.key === "$defs" || node.key === "definitions" || node.key === "components";
}

function contextOf(node: TreeNode): RefContext {
  if (node.expectedType === "Schema") return "schema";
  if (node.expectedType === "PathItem") return "pathItem";
  return "reference";
}

function childByKey(node: TreeNode, key: string): TreeNode | undefined {
  return node.children.find((c) => c.key === key);
}

export function childString(node: TreeNode, key: string): string | undefined {
  const child = childByKey(node, key);
  return child && child.valueKind === "string" ? (child.scalarValue as string) : undefined;
}

function childBool(node: TreeNode, key: string): boolean | undefined {
  const child = childByKey(node, key);
  return child && child.valueKind === "boolean" ? (child.scalarValue as boolean) : undefined;
}

function addAdvisory(schemaNode: TreeNode, childKey: string, advisory: ResolutionAdvisory): void {
  const target = childByKey(schemaNode, childKey) ?? schemaNode;
  (target.resolutionAdvisories ??= []).push(advisory);
}

export function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
