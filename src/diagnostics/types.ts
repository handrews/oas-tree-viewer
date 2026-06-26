// The unified diagnostic model: one shape for every non-blocking finding about an OAD, replacing the
// earlier per-source shapes (reference edge advisories, node-level resolution advisories, document
// warnings). Errors that *refuse* a document stay separate (thrown — see src/errors.ts); a Diagnostic
// is always non-blocking. The model is plain/cloneable so it crosses the worker boundary, and is
// located by JSON Pointer (Phase 2 adds a source range), so any pointer-emitting tool — including a
// future external linter — maps onto it via the `source` discriminator without reworking the model.

import type { RefKind } from "../refs/types";

/** Severity of an emitted diagnostic. (`info` is an FYI about how the document was interpreted.) */
export type Severity = "error" | "warning" | "info";

/** Severity as authored in the catalog policy: an emitted severity, or `off` to silence the rule. */
export type SeverityPolicy = Severity | "off";

/**
 * Where a diagnostic comes from, for grouping and filtering. `reference` — reference resolution and
 * its advisories; `schema` — schema-validation/dialect findings; `semantic` — other structural rules
 * (the growth path for new checks); `external` — a future adapted external linter.
 */
export type DiagnosticSource = "reference" | "schema" | "semantic" | "external";

/** A located point in the OAD: a JSON Pointer within a document (root is ""). */
export interface DiagnosticLocation {
  docId: string;
  /** JSON Pointer from the document root, in TreeNode.id form (root is ""). */
  pointer: string;
}

/**
 * The closed set of diagnostic codes. Kept as a runtime list so the catalog test can assert the
 * YAML policy file covers exactly these (recovering the compile-time safety a typed const gives that
 * YAML alone would not). A new check adds its code here and an entry in content/diagnostics.yaml.
 */
export const DIAGNOSTIC_CODES = [
  // Reference resolution status (a reference that did not cleanly resolve).
  "ref-broken",
  "ref-type-mismatch",
  "ref-external",
  // Advisories on a reference that *did* resolve but points somewhere problematic.
  "pathitem-field-overlap",
  "operation-target-webhook",
  "operation-target-callback",
  "operation-target-ambiguous",
  "operation-target-fragile",
  "operation-target-no-path",
  // Node-level reference-resolution caveats.
  "ignored-ref-siblings",
  "invalid-id-fragment",
  "dialect-resolution-unsupported",
  // Document-level findings.
  "document-unreachable",
  "schema-unvalidated",
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

/** Reference context for a diagnostic about a reference field — lets a report show the field label
 *  and the reference string. Omitted for non-reference diagnostics. */
export interface DiagnosticRef {
  kind?: RefKind;
  refString: string;
}

/** One non-blocking finding about the OAD. */
export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  source: DiagnosticSource;
  /** Color-free human text (the dynamic detail); the catalog holds the static title/description. */
  message: string;
  location: DiagnosticLocation;
  /** Other locations this finding relates to, e.g. a reference's resolved target. */
  relatedLocations?: DiagnosticLocation[];
  /** Set when the finding is about a reference field. */
  ref?: DiagnosticRef;
}
