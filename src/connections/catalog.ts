// Loads the connection style catalog (content/connections.yaml) — the base visual per connection kind —
// as plain data at build time (Vite `?raw` + the existing `yaml` parser, no new dependency). Mirrors
// src/diagnostics/catalog.ts: the parsed object is plain/cloneable, and the style for a kind is resolved
// through here so restyling a category is a one-line YAML edit.

import { parse } from "yaml";
import catalogText from "../../content/connections.yaml?raw";
import type { ConnectionKind, ConnectionStyle } from "./types";

// Typed as a total map over the kinds — a test asserts the YAML covers exactly CONNECTION_KINDS, so
// indexing by a ConnectionKind never misses.
const catalog = parse(catalogText) as Record<ConnectionKind, ConnectionStyle>;

/** The full catalog, keyed by kind (the validating test and the legend generator read this). */
export function connectionCatalog(): Readonly<Record<ConnectionKind, ConnectionStyle>> {
  return catalog;
}

/** The base visual for one connection kind. */
export function connectionStyle(kind: ConnectionKind): ConnectionStyle {
  return catalog[kind];
}
