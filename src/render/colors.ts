// Labels and theme-aware color classes for node categories, plus the data the legend
// renders. Shared by the tree, the detail panel, and the legend so they stay in sync. The
// actual colors live in CSS as --cat-* / --ref-* / --warn-* custom properties (one set per
// theme); code only selects the class, so markers and swatches recolor automatically when
// the theme changes.

import type { NodeCategory, ResolutionKind } from "../types";
import type { EdgeDiagnostic } from "../refs/types";

/** CSS class that selects a category's themed color (--cat-<category>). */
export function categoryClass(category: NodeCategory | undefined): string {
  return `cat-${category ?? "object"}`;
}

/** Categories drawn as squares (the generic JSON value kinds); everything else is a circle. */
const SQUARE_CATEGORIES: ReadonlySet<NodeCategory> = new Set(["object", "array", "scalar"]);

/**
 * Marker/swatch shape for a category, used identically in the tree and the legend.
 * Reference Objects are drawn as an asterisk instead, keyed off `isReference` at the call
 * site — not handled here, since a reference's category is its (Structural) color group.
 */
export function categoryShape(category: NodeCategory | undefined): "square" | "circle" {
  return category && SQUARE_CATEGORIES.has(category) ? "square" : "circle";
}

/** Human-readable name for each category, used in the legend and detail panel. */
export const categoryLabel: Record<NodeCategory, string> = {
  structural: "Structural",
  metadata: "Metadata",
  http: "HTTP",
  data: "Data modeling",
  security: "Security",
  object: "object (untyped)",
  array: "array",
  scalar: "scalar value",
};

/** The five semantic object groups, in legend display order (each a colored circle). */
export const legendGroups: NodeCategory[] = [
  "structural",
  "metadata",
  "http",
  "data",
  "security",
];

/** Marker shapes. circle/square are node shapes; asterisk/diamond mark reference pointers
 *  (which one is used depends on how the reference resolved — see {@link resolutionStyles}). */
export type MarkerShape = "circle" | "square" | "asterisk" | "diamond";
export const shapeLegend: ReadonlyArray<{ shape: MarkerShape; label: string }> = [
  { shape: "circle", label: "Typed OAS object (colored by group above)" },
  { shape: "square", label: "Generic JSON value — object, array, or scalar" },
];

export type LineStyle = "single" | "double";

/**
 * The visual treatment for each way a reference resolves. This one table drives the tree
 * marker, the edge arrow, and the legend, so they can't drift — and a future ResolutionKind
 * is purely additive (add an entry + the legend/marker/arrow follow automatically).
 */
export interface ResolutionStyle {
  marker: MarkerShape;
  line: LineStyle;
  arrowhead: "filled" | "open";
  /** Dotted stroke for a *tentative* connection (a dynamic `$dynamicRef`); solid otherwise. */
  dash?: "dotted";
  label: string;
}
export const resolutionStyles: Record<ResolutionKind, ResolutionStyle> = {
  "uri-reference": {
    marker: "asterisk",
    line: "single",
    arrowhead: "filled",
    label: "URI-reference ($ref, operationRef, or a mapping / security value used as a URI)",
  },
  "component-name": {
    marker: "diamond",
    line: "double",
    arrowhead: "open",
    label: "Implicit connection — component name (discriminator mapping, security requirement)",
  },
  // A Link's `operationId` is an implicit connection drawn exactly like a component name; it
  // shares that visual but is reported under its own kind. The legend folds it into the single
  // implicit-connection row below (see `referenceLegend`).
  "operation-id": {
    marker: "diamond",
    line: "double",
    arrowhead: "open",
    label: "Implicit connection — a Link operationId",
  },
  // A `$dynamicRef` that engages dynamic scope: tentative, since its real target depends on the
  // evaluation path. Same asterisk marker as a URI-reference (it is one syntactically), but drawn
  // with a dotted line to all possible `$dynamicAnchor`s.
  "dynamic": {
    marker: "asterisk",
    line: "single",
    arrowhead: "open",
    dash: "dotted",
    label: "Tentative — a $dynamicRef to a possible $dynamicAnchor (actual target is path-dependent)",
  },
};

/** The legend's "References" section: one row per *distinct visual*. `component-name` and
 *  `operation-id` share the implicit-connection visual, so they collapse into one labeled row. */
export const referenceLegend: ReadonlyArray<{ kind: ResolutionKind } & ResolutionStyle> = [
  { kind: "uri-reference", ...resolutionStyles["uri-reference"] },
  {
    kind: "component-name",
    ...resolutionStyles["component-name"],
    label:
      "Implicit connection — component name (discriminator mapping, security requirement) or a Link operationId",
  },
  { kind: "dynamic", ...resolutionStyles["dynamic"] },
];

/** Arc styles that aren't a resolution kind, for the legend's "Connection lines" section:
 *  the collapsed/off-screen-endpoint state, and the type-mismatch arc (drawn dashed in the
 *  error color — the reference located a node, but of the wrong type). */
export const lineLegend: ReadonlyArray<{ variant: "collapsed" | "type-mismatch"; label: string }> = [
  { variant: "collapsed", label: "An endpoint is collapsed or off-screen" },
  { variant: "type-mismatch", label: "Type mismatch — the reference resolved to the wrong type" },
];

/** Error-icon (⚠) colors, for the legend's "Error icons" section. Mirrors the two on-tree
 *  glyph statuses (`broken`, `external`); `type-mismatch` is shown only in the detail panel. */
export const errorIconLegend: ReadonlyArray<{ status: "broken" | "external"; label: string }> = [
  { status: "broken", label: "Unresolved reference — target not found" },
  { status: "external", label: "Unresolved reference — document not loaded" },
];

/** The single document-level warning, for the legend's "Documents" section. */
export const warningLegend = {
  unreachable: "Document not reachable from the entry document",
} as const;

/**
 * Color treatment for a reference advisory (a reference that resolves but is semantically
 * problematic), keyed off its severity. Mirrors the {@link resolutionStyles} pattern: the legend,
 * the on-canvas glyph, and the arc tint all read this so they can't drift. Error = the softer of
 * the two error colors (orange `--error`, distinct from the vermillion `--ref-broken` reserved for
 * genuinely-broken refs); warning = yellow `--warn`.
 */
export type DiagnosticSeverity = EdgeDiagnostic["severity"];
export interface DiagnosticStyle {
  /** CSS class selecting the themed color (`diag-error` → --error, `diag-warning` → --warn). */
  colorClass: string;
  /** SVG advisory glyph — a triangle, distinct from the ⚠ used for unresolved references. */
  glyph: string;
  label: string;
}
export const diagnosticStyles: Record<DiagnosticSeverity, DiagnosticStyle> = {
  error: {
    colorClass: "diag-error",
    glyph: "▲",
    label:
      "Reference advisory (error) — undefined behavior, or an Operation that is not directly invocable",
  },
  warning: {
    colorClass: "diag-warning",
    glyph: "▲",
    label: "Reference advisory (warning) — an operation reference that may break if paths change",
  },
};

/** `diagnosticStyles` as an ordered list, for the legend's "Reference advisories" section. */
export const diagnosticLegend: ReadonlyArray<{ severity: DiagnosticSeverity } & DiagnosticStyle> = (
  ["error", "warning"] as DiagnosticSeverity[]
).map((severity) => ({ severity, ...diagnosticStyles[severity] }));
