// Build a purely structural parent/child tree from a parsed JSON/YAML value.
// No OAS knowledge here — that is layered on afterwards by the classifier.

import type { TreeNode, ValueKind } from "../types";
import { appendPointer, displayPointer } from "./jsonPointer";
import { defaultLimits, type Limits } from "../limits";
import { ResourceLimitError } from "../errors";

/** Running state for the build, used to enforce the depth and node-count caps as we go. */
interface BuildContext {
  limits: Limits;
  count: number;
}

/**
 * Build the full tree for a document. The root node has JSON Pointer "". `limits` caps the tree's depth
 * and node count, throwing a {@link ResourceLimitError} the moment either is exceeded (an early bail, so
 * a runaway document never gets fully materialized). Every later stage walks this tree recursively, so
 * the depth cap here is what keeps them all from overflowing the stack.
 */
export function buildTree(value: unknown, limits: Limits = defaultLimits): TreeNode {
  return buildNode(value, "", null, "root", { limits, count: 0 }, 0);
}

function buildNode(
  value: unknown,
  id: string,
  key: string | null,
  keyKind: TreeNode["keyKind"],
  ctx: BuildContext,
  depth: number,
): TreeNode {
  if (depth > ctx.limits.maxDepth) {
    // The pointer to a node this deep repeats the same token many times; show only enough to locate it.
    const where = displayPointer(id);
    const located = where.length > 60 ? `${where.slice(0, 60)}…` : where;
    throw new ResourceLimitError(
      "depth",
      `Document is nested too deeply (over ${ctx.limits.maxDepth} levels at ${located}). ` +
        `It is too deeply nested to render.`,
    );
  }
  if (++ctx.count > ctx.limits.maxNodes) {
    throw new ResourceLimitError(
      "nodes",
      `Document has too many nodes (over ${ctx.limits.maxNodes.toLocaleString()}). ` +
        `It is too large to render.`,
    );
  }

  const valueKind = kindOf(value);
  const node: TreeNode = { id, key, keyKind, valueKind, children: [] };

  if (valueKind === "object") {
    const obj = value as Record<string, unknown>;
    // Preserve document key order so the tree mirrors the source document.
    for (const childKey of Object.keys(obj)) {
      node.children.push(
        buildNode(obj[childKey], appendPointer(id, childKey), childKey, "property", ctx, depth + 1),
      );
    }
  } else if (valueKind === "array") {
    const arr = value as unknown[];
    arr.forEach((item, index) => {
      const token = String(index);
      node.children.push(buildNode(item, appendPointer(id, token), token, "index", ctx, depth + 1));
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
