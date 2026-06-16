// Typed errors so the UI can show distinct, accurate messages for each failure mode.

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

// ── OAD-level errors ───────────────────────────────────────────────────────

/** No document was marked as the entry document. */
export class NoEntryError extends OadError {}

/** More than one document was marked as the entry document. */
export class MultipleEntryError extends OadError {}

/** Documents mix OAS 3.1 and 3.2, which is unsupported for now. */
export class VersionMismatchError extends OadError {}

/** Convenience for extracting a human-readable message from an unknown throwable. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
