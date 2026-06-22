// Dialect recognition shared by schema validation (validateOad) and the resolution-support
// warning. A "dialect" is the URI a Schema Object declares in `$schema`, or a document declares
// in `jsonSchemaDialect`; absent, it defaults to the OAS dialect for the document's version.

import type { TreeNode, VersionFamily } from "../types";

/** Standard JSON Schema 2020-12 dialect / meta-schema URI. */
export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/** The numbered (`draft-NN`) meta-schema URIs whose referencing model this tool resolves. */
export const DRAFT_07 = "http://json-schema.org/draft-07/schema";
export const DRAFT_06 = "http://json-schema.org/draft-06/schema";
export const DRAFT_04 = "http://json-schema.org/draft-04/schema";

/**
 * The OAS dialect meta-schema URI bundled (and registered) by `@hyperjump/json-schema` for a
 * version. 3.1 publishes it under `/dialect/base`; 3.2 under `/dialect`.
 */
export function oasDialectUri(version: VersionFamily): string {
  return version === "3.2"
    ? "https://spec.openapis.org/oas/3.2/dialect"
    : "https://spec.openapis.org/oas/3.1/dialect/base";
}

/** Any `https://spec.openapis.org/oas/<version>/dialect[...]` URI is the OAS dialect (base or dated). */
export function isOasDialect(uri: string, version: VersionFamily): boolean {
  return new RegExp(`^https://spec\\.openapis\\.org/oas/${version}/dialect(/|$)`).test(uri);
}

/** Drop a trailing `#` — draft-04/06/07 meta-schemas are registered without it. */
export function normalizeDialect(uri: string): string {
  return uri.replace(/#$/, "");
}

/**
 * The referencing/identification rules a declared dialect uses, as far as this tool resolves them:
 *  - `"2020-12"` — the modern/date-formatted model: `$anchor` named anchors, a fragmentless `$id`,
 *    `$ref` siblings apply, and `$dynamicRef` dynamic scope. Covers the OAS dialect and 2020-12.
 *  - `"numbered-draft"` — the `draft-NN` model, for the numbered drafts this tool resolves:
 *    **draft-04, draft-06, and draft-07**. Anchors come from identifier fragments, `$ref` siblings
 *    are ignored, and `$anchor`/`$dynamicAnchor`/`$dynamicRef` don't exist. The identifier keyword is
 *    `id` in draft-04 and `$id` in draft-06/07 (see {@link idKeyword}). Older numbered drafts
 *    (draft-03 and earlier) were never widely used and aren't registered by Hyperjump, so they fall
 *    through to `"unsupported"`.
 *  - `"unsupported"` — anything else (2019-09, draft-03 and earlier, unknown): resolved with the
 *    2020-12 model as a best effort, and flagged with the dialect ⚠.
 */
export type ReferenceModel = "2020-12" | "numbered-draft" | "unsupported";

export function referenceModel(dialect: string | undefined, version: VersionFamily): ReferenceModel {
  if (dialect === undefined || isOasDialect(dialect, version)) return "2020-12";
  const normalized = normalizeDialect(dialect);
  if (normalized === DRAFT_2020_12) return "2020-12";
  if (normalized === DRAFT_07 || normalized === DRAFT_06 || normalized === DRAFT_04) {
    return "numbered-draft";
  }
  return "unsupported";
}

/**
 * The base/identifier keyword a dialect uses: draft-04 → `id`, every other dialect → `$id`.
 * (`_version` is unused but kept for signature parity with `referenceModel`/`isOasDialect`.)
 */
export function idKeyword(dialect: string | undefined, _version: VersionFamily): "$id" | "id" {
  return dialect !== undefined && normalizeDialect(dialect) === DRAFT_04 ? "id" : "$id";
}

/**
 * Whether the viewer resolves a dialect's references with its own rules (vs. a 2020-12 best-effort
 * fallback + a ⚠). True for the OAS dialect, 2020-12, and draft-06/07; false otherwise. A
 * `$schema` / `jsonSchemaDialect` that is false here gets the resolution-warning marker.
 */
export function isResolutionSupported(dialect: string | undefined, version: VersionFamily): boolean {
  return referenceModel(dialect, version) !== "unsupported";
}

function resolutionNote(uri: string): string {
  return (
    `Reference resolution for dialect "${uri}" isn't fully supported; ` +
    `references here are drawn using JSON Schema 2020-12 rules.`
  );
}

/**
 * Flag the `$schema` (on a Schema Object) and `jsonSchemaDialect` (on the OpenAPI Object) value
 * nodes whose declared dialect the viewer can't fully *resolve*, so the tree can show a warning
 * marker and the detail panel a note. Runs after classification (it keys off `oasType`).
 */
export function annotateDialectSupport(root: TreeNode, version: VersionFamily): void {
  const visit = (node: TreeNode): void => {
    const key =
      node.oasType === "OpenAPI Object"
        ? "jsonSchemaDialect"
        : node.oasType === "Schema Object"
          ? "$schema"
          : undefined;
    if (key) {
      const field = node.children.find((c) => c.key === key);
      if (field && field.valueKind === "string") {
        const uri = field.scalarValue as string;
        if (!isResolutionSupported(uri, version)) field.dialectResolutionWarning = resolutionNote(uri);
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
}
