// Loads the diagnostic catalog (content/diagnostics.yaml) — the severity policy + static copy per
// code — as plain data at build time (Vite `?raw` + the existing `yaml` parser, no new dependency).
// The parsed object is plain/cloneable, so importing this in the pipeline worker is safe. Severity is
// resolved through here at the single point a rule stamps a diagnostic, so changing a code's loudness
// is a one-line YAML edit (and `off` drops the diagnostic entirely).

import { parse } from "yaml";
import catalogText from "../../content/diagnostics.yaml?raw";
import type { DiagnosticCode, Severity, SeverityPolicy } from "./types";

export interface CatalogEntry {
  severity: SeverityPolicy;
  title: string;
  description: string;
}

// Typed as a total map over the codes — a test asserts the YAML covers exactly DIAGNOSTIC_CODES, so
// indexing by a DiagnosticCode never misses.
const catalog = parse(catalogText) as Record<DiagnosticCode, CatalogEntry>;

/** The full catalog, keyed by code (the validating test, the report, and the legend read this). */
export function diagnosticCatalog(): Readonly<Record<DiagnosticCode, CatalogEntry>> {
  return catalog;
}

/** The configured severity policy for a code (an emitted severity, or `"off"`). */
export function severityFor(code: DiagnosticCode): SeverityPolicy {
  return catalog[code].severity;
}

/** Resolve a policy to the severity a diagnostic should carry, or `null` when the rule is `off`. Pure
 *  (a plain function of the policy) so both arms are testable without an `off` entry in the catalog. */
export function emittedSeverity(policy: SeverityPolicy): Severity | null {
  return policy === "off" ? null : policy;
}
