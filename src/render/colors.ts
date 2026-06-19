// Labels and theme-aware color classes for node categories. Shared by the tree,
// the detail panel, and the legend so they stay in sync. The actual colors live
// in CSS as --cat-* custom properties (one set per theme); code only selects the
// class, so markers and swatches recolor automatically when the theme changes.

import type { NodeCategory } from "../types";

/** CSS class that selects a category's themed color (--cat-<category>). */
export function categoryClass(category: NodeCategory | undefined): string {
  return `cat-${category ?? "object"}`;
}

/** Categories drawn as squares (the structural value kinds); everything else is a circle. */
const SQUARE_CATEGORIES: ReadonlySet<NodeCategory> = new Set(["object", "array", "scalar"]);

/** Marker/swatch shape for a category, used identically in the tree and the legend. */
export function categoryShape(category: NodeCategory | undefined): "square" | "circle" {
  return category && SQUARE_CATEGORIES.has(category) ? "square" : "circle";
}

/** Human-readable name for each category, used in the legend. */
export const categoryLabel: Record<NodeCategory, string> = {
  root: "OpenAPI root",
  structure: "Structure / map",
  operation: "Operation",
  schema: "Schema",
  io: "Request / response",
  meta: "Info / metadata",
  security: "Security",
  reference: "Reference ($ref)",
  object: "object (untyped)",
  array: "array",
  scalar: "scalar value",
};

/** Categories shown in the legend, in display order. */
export const legendOrder: NodeCategory[] = [
  "root",
  "structure",
  "operation",
  "io",
  "schema",
  "meta",
  "security",
  "reference",
  "object",
  "array",
  "scalar",
];
