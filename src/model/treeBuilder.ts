// Build a purely structural parent/child tree from a parsed JSON/YAML value.
// No OAS knowledge here — that is layered on afterwards by the classifier.

import type { TreeNode, ValueKind } from "../types";
import { appendPointer } from "./jsonPointer";

/** Build the full tree for a document. The root node has JSON Pointer "". */
export function buildTree(value: unknown): TreeNode {
  return buildNode(value, "", null, "root");
}

function buildNode(
  value: unknown,
  id: string,
  key: string | null,
  keyKind: TreeNode["keyKind"],
): TreeNode {
  const valueKind = kindOf(value);
  const node: TreeNode = { id, key, keyKind, valueKind, children: [] };

  if (valueKind === "object") {
    const obj = value as Record<string, unknown>;
    // Preserve document key order so the tree mirrors the source document.
    for (const childKey of Object.keys(obj)) {
      node.children.push(
        buildNode(obj[childKey], appendPointer(id, childKey), childKey, "property"),
      );
    }
  } else if (valueKind === "array") {
    const arr = value as unknown[];
    arr.forEach((item, index) => {
      const token = String(index);
      node.children.push(buildNode(item, appendPointer(id, token), token, "index"));
    });
  } else {
    node.scalarValue = value as string | number | boolean | null;
  }

  return node;
}

/** Classify a parsed value into one of the JSON value kinds. */
export function kindOf(value: unknown): ValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object":
      return "object";
    case "string":
      return "string";
    case "number":
    case "bigint":
      return "number";
    case "boolean":
      return "boolean";
    default:
      // undefined / function / symbol cannot arise from JSON or YAML parsing.
      return "null";
  }
}

/** Count the descendants of a node (for "N children" summaries in the UI). */
export function descendantCount(node: TreeNode): number {
  let total = node.children.length;
  for (const child of node.children) total += descendantCount(child);
  return total;
}
