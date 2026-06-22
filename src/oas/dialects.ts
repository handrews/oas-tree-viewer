// Dialect recognition shared by schema validation (validateOad) and the resolution-support
// warning. A "dialect" is the URI a Schema Object declares in `$schema`, or a document declares
// in `jsonSchemaDialect`; absent, it defaults to the OAS dialect for the document's version.

import type { TreeNode, VersionFamily } from "../types";

/** Standard JSON Schema 2020-12 dialect / meta-schema URI. */
export const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

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
 * Reference resolution is only correct for the OAS dialect and JSON Schema 2020-12 (other drafts
 * resolve `$ref`/`$dynamicRef` differently). A `$schema` / `jsonSchemaDialect` declaring anything
 * else gets the resolution-warning marker. Absent ⇒ the OAS dialect ⇒ supported.
 */
export function isResolutionSupported(dialect: string | undefined, version: VersionFamily): boolean {
  if (dialect === undefined) return true;
  return isOasDialect(dialect, version) || normalizeDialect(dialect) === DRAFT_2020_12;
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
