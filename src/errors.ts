// Typed errors so the UI can show distinct, accurate messages for each failure mode.

import type { SchemaViolation } from "./validation/validateOad";

/** Base class for everything that can go wrong loading/validating an OAD. */
export class OadError extends Error {
  constructor(message: string) {
    super(message);
    // Use the concrete subclass name so messages and logs read clearly.
    this.name = new.target.name;
  }
}

// ── Per-document errors ────────────────────────────────────────────────────

/** The document text could not be fetched or read. */
export class RetrievalError extends OadError {}

/** The document is not valid JSON or YAML. */
export class ParseError extends OadError {}

/** The document parsed, but has no valid root `openapi` version field. */
export class NotOpenApiError extends OadError {}

/** The document is OpenAPI, but a version this tool does not support (only 3.1/3.2). */
export class UnsupportedVersionError extends OadError {}

/** The document is OpenAPI of a supported version, but structurally invalid — e.g. a Link
 *  Object that sets both `operationRef` and `operationId` (a Link must use exactly one). */
export class InvalidDocumentError extends OadError {}

/** The document is OpenAPI of a supported version, but fails JSON Schema validation against the
 *  official OpenAPI schema. `violations` carry the located failures for the UI. */
export class SchemaValidationError extends OadError {
  readonly violations: SchemaViolation[];
  constructor(message: string, violations: SchemaViolation[]) {
    super(message);
    this.violations = violations;
  }
}

/** The document exceeds a resource guard — too many source bytes, too deeply nested, or too many
 *  nodes — and was refused before the pipeline could consume excessive time or memory on it. `kind`
 *  lets the UI recognize a limit failure and offer a "Load anyway" override. */
export class ResourceLimitError extends OadError {
  readonly kind: "bytes" | "depth" | "nodes";
  constructor(kind: ResourceLimitError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

// ── OAD-level errors ───────────────────────────────────────────────────────

/** Documents mix OAS 3.1 and 3.2, which is unsupported for now. */
export class VersionMismatchError extends OadError {}

/** Two Operations in the OAD declare the same `operationId`. `operationId`s must be unique
 *  across all loaded documents, since a Link's `operationId` must identify exactly one. */
export class DuplicateOperationIdError extends OadError {}

/** Convenience for extracting a human-readable message from an unknown throwable. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
