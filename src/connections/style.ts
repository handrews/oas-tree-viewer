// Pure style selection for a drawn connection: the single place that turns a connection kind + its render
// state into the CSS classes / marker / arrowhead the canvas applies. This replaces the hand-assembled
// class string in canvas.ts (`baseClass`), the single/double filter, and the `markerEnd` choice — so the
// canvas, the tree marker, and the legend all read one source. It emits exactly the classes the existing
// CSS resolves, so swapping the renderer onto it is visually identical.
//
// Two layers: the *base* visual comes from the catalog (per connection kind); the *modifier* axes — resolve
// status, advisory severity, collapsed/off-screen endpoint, focus — are render state passed in here. Only
// the base dash is selected here; the modifier dashes (collapsed, type-mismatch) keep their own CSS classes,
// resolved by the cascade exactly as before.

import type { RefStatus } from "../refs/types";
import { connectionStyle } from "./catalog";
import type { ConnectionKind, ConnectionMarker, DashStyle } from "./types";

/** Render state layered on a connection's base style. A relationship has no resolve `status`. */
export interface ConnectionState {
  /** Reference resolve outcome (drives the status-* color/dash); absent for a relationship. */
  status?: RefStatus;
  /** Strongest advisory severity at the connection's source, from the unified diagnostics (or null). */
  advisory?: "error" | "warning" | null;
  /** An endpoint is collapsed or off-screen. */
  collapsed?: boolean;
  /** The connection touches the selected node. */
  focused?: boolean;
}

/** CSS class for a *base* dash token (`solid` → none). Modifier dashes (collapsed, type-mismatch) carry
 *  their own classes, so this is only the connection's intrinsic dash. */
export function dashClass(dash: DashStyle): string | null {
  switch (dash) {
    case "dotted":
      return "dotted";
    case "dashed":
      return "dashed";
    case "solid":
      return null;
  }
}

/** The ordered class list for a drawn connection — the one source the canvas applies to each arc, replacing
 *  the hand-built string. Emits exactly the classes the existing CSS resolves (base dash + status + advisory
 *  tint + collapsed + focused). */
export function connectionClasses(kind: ConnectionKind, state: ConnectionState): string[] {
  const classes = ["ref-edge"];
  if (state.status) classes.push(`status-${state.status}`);
  if (state.advisory) classes.push(`diag-${state.advisory}`);
  const dash = dashClass(connectionStyle(kind).dash);
  if (dash) classes.push(dash);
  if (state.collapsed) classes.push("collapsed");
  if (state.focused) classes.push("focused");
  return classes;
}

/** Whether a kind draws as a double line (two offset strokes), vs a single stroke. */
export function isDoubleLine(kind: ConnectionKind): boolean {
  return connectionStyle(kind).line === "double";
}

/** The SVG `<marker>` id for a kind's arrowhead (filled vs open/stick). */
export function arrowheadMarkerId(kind: ConnectionKind): string {
  return connectionStyle(kind).arrowhead === "open" ? "ref-arrow-open" : "ref-arrow";
}

/** The tree-row source marker shape for a kind (asterisk for URI-references, diamond for implicit). */
export function connectionMarker(kind: ConnectionKind): ConnectionMarker {
  return connectionStyle(kind).marker;
}
