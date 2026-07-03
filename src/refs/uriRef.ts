// Resolve a single URI-reference (the `$ref` / `operationRef` path, reused by component-or-URI and
// dynamic references): split into resource URI + fragment, locate the resource, then locate the node
// by JSON Pointer or `$anchor`/plain-name fragment, and check the slot's expected type.

import type { TreeNode } from "../types";
import type { RefStatus } from "./types";
import { decodeFragment, resolveUri, splitFragment } from "./baseUri";
import type { Indexes, Resource } from "./indexer";

export interface UriResult {
  status: RefStatus;
  targetDocId?: string;
  targetNodeId?: string;
  targetType?: string;
  resolvedUri?: string;
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
    // JSON Pointer relative to the resource root node.
    const pointer = resource.rootNode.id + decoded;
    return indexes.pointerIndex.get(resource.doc.id)?.get(pointer);
  }
  // Plain-name / $anchor fragment.
  return indexes.anchorByUri.get(`${resourceUri}#${decoded}`);
}

function withFragment(uri: string, fragment: string | null): string {
  return fragment === null ? uri : `${uri}#${fragment}`;
}
