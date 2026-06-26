// The connection taxonomy. Every cross-node connection the canvas draws (today: references; designed for
// future structural relationships such as a parameter override — drawn, never performed) has a `kind`
// whose base visual is data in content/connections.yaml. This module fixes the *vocabulary* that the YAML
// selects from: a bounded set of tokens, each mapping to a fixed CSS class, so the catalog never encodes
// raw CSS. The runtime arrays here are the single source the validating test checks the YAML against.

import type { ResolutionKind } from "../types";

/** A drawn connection's family: a reference (located by the resolver) or a structural relationship (a
 *  fact the viewer *shows*, never performs). Only `reference` is produced today; `relationship` is the
 *  seam for future, non-reference connections. */
export const CONNECTION_FAMILIES = ["reference", "relationship"] as const;
export type ConnectionFamily = (typeof CONNECTION_FAMILIES)[number];

/** Base-style vocabularies — bounded sets that map to fixed CSS classes. Adding a value is a code + CSS
 *  change; *selecting* one (per connection kind) is a content/connections.yaml edit. */
export const LINE_STYLES = ["single", "double"] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

export const DASH_STYLES = ["solid", "dashed", "dotted"] as const;
export type DashStyle = (typeof DASH_STYLES)[number];

export const ARROWHEAD_STYLES = ["filled", "open"] as const;
export type ArrowheadStyle = (typeof ARROWHEAD_STYLES)[number];

export const CONNECTION_MARKERS = ["asterisk", "diamond"] as const;
export type ConnectionMarker = (typeof CONNECTION_MARKERS)[number];

/** The connection kinds with a style entry. Today these are exactly the reference `ResolutionKind`s, so
 *  `connectionStyle(edge.resolution)` is total; a future relationship kind is additive (a new key + a
 *  content/connections.yaml row). The assignment below is a compile-time check that the two stay aligned. */
export const CONNECTION_KINDS = [
  "uri-reference",
  "component-name",
  "operation-id",
  "dynamic",
] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

// Compile-time: every reference ResolutionKind must be a ConnectionKind (else the call sites that pass
// `edge.resolution` to connectionStyle would not type-check). Kept as a type alias, no runtime artifact.
export type ResolutionIsConnectionKind = ResolutionKind extends ConnectionKind ? true : never;

/** The base visual for one connection kind — the admin-/writer-editable row in content/connections.yaml. */
export interface ConnectionStyle {
  family: ConnectionFamily;
  line: LineStyle;
  dash: DashStyle;
  arrowhead: ArrowheadStyle;
  marker: ConnectionMarker;
  label: string;
}
