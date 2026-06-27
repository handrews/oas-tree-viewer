import type { OadDocument, TreeNode } from "../types";
import type { RefStatus } from "./types";
import { decodeFragment, normalizeUri, resolveUri, splitFragment } from "./baseUri";

export interface Resource {
  rootNode: TreeNode;
  doc: OadDocument;
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

export interface UriResult {
  status: RefStatus;
  targetDocId?: string;
  targetNodeId?: string;
  targetType?: string;
  resolvedUri?: string;
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

export function resolveUriRef(
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
    target.expectedType === undefined ||
    requiredType === "" ||
    target.expectedType === requiredType;
  return {
    status: typeOk ? "resolved" : "type-mismatch",
    targetDocId: resource.doc.id,
    targetNodeId: target.id,
    targetType: target.expectedType,
    resolvedUri,
  };
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
    const pointer = resource.rootNode.id + decoded;
    return indexes.pointerIndex.get(resource.doc.id)?.get(pointer);
  }
  return indexes.anchorByUri.get(`${resourceUri}#${decoded}`);
}

function withFragment(uri: string, fragment: string | null): string {
  return fragment === null ? uri : `${uri}#${fragment}`;
}

export function nodeKey(docId: string, nodeId: string): string {
  return `${docId}\0${nodeId}`;
}

export function isDefsBoundary(node: TreeNode): boolean {
  return node.key === "$defs" || node.key === "definitions" || node.key === "components";
}

export function childByKey(node: TreeNode, key: string): TreeNode | undefined {
  return node.children.find((c) => c.key === key);
}

export function childString(node: TreeNode, key: string): string | undefined {
  const child = childByKey(node, key);
  return child && child.valueKind === "string" ? (child.scalarValue as string) : undefined;
}

export function childBool(node: TreeNode, key: string): boolean | undefined {
  const child = childByKey(node, key);
  return child && child.valueKind === "boolean" ? (child.scalarValue as boolean) : undefined;
}

export function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
