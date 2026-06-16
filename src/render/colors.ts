// Color and label mappings for node categories. Shared by the tree, the detail
// panel, and the legend so they stay in sync.

import type { NodeCategory } from "../types";

export const categoryColor: Record<NodeCategory, string> = {
  root: "#e94560",
  structure: "#53b8f5",
  operation: "#f5a623",
  schema: "#7ed957",
  io: "#b06ef5",
  meta: "#8899aa",
  security: "#f55d7a",
  reference: "#ffd166",
  object: "#5a7aa8",
  array: "#4a93a8",
  scalar: "#5b6b85",
};

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
  object: "Object (untyped)",
  array: "Array",
  scalar: "Scalar value",
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

export function colorFor(category: NodeCategory | undefined): string {
  return category ? categoryColor[category] : categoryColor.object;
}
