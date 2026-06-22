// Validate a loaded document against the official OpenAPI JSON Schema, offline.
//
// `@hyperjump/json-schema` pre-loads the OAS 3.1/3.2 schema families (envelope `schema`, the
// OAS-dialect `schema-base`, and a `schema-draft-2020-12` variant) plus the JSON Schema 2020-12
// core — all bundled, so nothing is fetched at runtime. We pick the validation entry schema from
// the document's declared Schema-Object dialect (its `jsonSchemaDialect` and any Schema-Object
// `$schema`), validating deeply against the OAS dialect or standard 2020-12, and falling back to
// envelope-only ("loose") validation plus a warning for any dialect we don't yet support.
//
// The Hyperjump import is dynamic so the validator + its schemas land in a lazily-loaded chunk,
// keeping them out of the initial app bundle.

import type { TreeNode, VersionFamily } from "../types";

/** One schema-validation failure, located by JSON Pointer within the document. */
export interface SchemaViolation {
  /** JSON Pointer (no leading `#`); "" is the document root. */
  pointer: string;
  /** The meaningful failing schema keywords at this location (applicators filtered out). */
  keywords: string[];
  message: string;
}

export interface ValidationResult {
  violations: SchemaViolation[];
  /** Present when the document's Schema-Object dialect isn't validated deeply (loose fallback). */
  dialectWarning?: string;
}

/** Standard JSON Schema 2020-12 dialect URI. */
const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/** Any `https://spec.openapis.org/oas/<version>/dialect[...]` URI is the OAS dialect (base or dated). */
function isOasDialect(uri: string, version: VersionFamily): boolean {
  return new RegExp(`^https://spec\\.openapis\\.org/oas/${version}/dialect(/|$)`).test(uri);
}

type DialectKind = "oas" | "2020-12" | "other";

function classifyDialect(uri: string | undefined, version: VersionFamily): DialectKind {
  if (uri === undefined) return "oas"; // absent jsonSchemaDialect ⇒ the OAS dialect default
  if (isOasDialect(uri, version)) return "oas";
  if (uri === DRAFT_2020_12) return "2020-12";
  return "other";
}

/** Pre-loaded Hyperjump schema URIs, by role, for a version family. */
function entrySchemas(version: VersionFamily): { base: string; draft202012: string; loose: string } {
  const root = `https://spec.openapis.org/oas/${version}`;
  return { base: `${root}/schema-base`, draft202012: `${root}/schema-draft-2020-12`, loose: `${root}/schema` };
}

/**
 * Choose the validation entry schema from the document's declared dialects. Pure (no Hyperjump),
 * so it is unit-testable on its own. v1 decides by the document default; if any declared dialect is
 * unsupported, fall back to loose validation with a warning. (Mixed *supported* dialects across
 * Schema Objects are validated against the default's schema for now — see the plan.)
 */
export function selectValidationSchema(
  defaultDialect: string | undefined,
  overrideDialects: readonly string[],
  version: VersionFamily,
): { entryUri: string; dialectWarning?: string } {
  const schemas = entrySchemas(version);
  const all = [defaultDialect, ...overrideDialects];
  const unsupported = [
    ...new Set(all.filter((d): d is string => d !== undefined && classifyDialect(d, version) === "other")),
  ];

  if (unsupported.length > 0) {
    const list = unsupported.join(", ");
    return {
      entryUri: schemas.loose,
      dialectWarning:
        `Schema Objects use the dialect ${list}, which this tool can't yet validate. ` +
        `The document structure was validated, but its Schema Objects were not.`,
    };
  }

  if (classifyDialect(defaultDialect, version) === "2020-12") return { entryUri: schemas.draft202012 };
  return { entryUri: schemas.base };
}

/** The document-level `jsonSchemaDialect`, if present and a string. */
function documentDialect(value: unknown): string | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const d = (value as Record<string, unknown>)["jsonSchemaDialect"];
    if (typeof d === "string") return d;
  }
  return undefined;
}

/** Every distinct `$schema` declared on a Schema Object in the classified tree. */
function schemaObjectDialects(root: TreeNode): string[] {
  const found = new Set<string>();
  const visit = (node: TreeNode): void => {
    if (node.oasType === "Schema Object") {
      const schema = node.children.find((c) => c.key === "$schema");
      if (schema && schema.valueKind === "string") found.add(schema.scalarValue as string);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return [...found];
}

// Applicator / structural keywords carry no useful "what's wrong here" signal in a message.
const NOISE_KEYWORDS = new Set([
  "ref", "dynamicRef", "anyOf", "allOf", "oneOf", "not", "if", "then", "else",
  "properties", "additionalProperties", "patternProperties", "items", "prefixItems",
  "contains", "dependentSchemas", "propertyNames", "unevaluatedProperties", "unevaluatedItems",
]);

interface BasicErrorUnit {
  keyword?: string;
  instanceLocation?: string;
  absoluteKeywordLocation?: string;
}
interface BasicOutput {
  valid: boolean;
  errors?: BasicErrorUnit[];
}

/** Map Hyperjump's BASIC output into located, de-duplicated violations. */
function toViolations(output: BasicOutput, version: VersionFamily): SchemaViolation[] {
  const byPointer = new Map<string, Set<string>>();
  for (const unit of output.errors ?? []) {
    if (unit.instanceLocation === undefined) continue;
    const pointer = unit.instanceLocation.replace(/^#/, "");
    const keyword = unit.keyword?.split("/").pop() ?? "";
    const set = byPointer.get(pointer) ?? byPointer.set(pointer, new Set()).get(pointer)!;
    if (keyword && !NOISE_KEYWORDS.has(keyword)) set.add(keyword);
  }
  // Nothing located (every error was an applicator): emit one root-level violation.
  if (byPointer.size === 0) {
    return [{ pointer: "", keywords: [], message: `does not conform to the OpenAPI ${version} schema` }];
  }
  return [...byPointer].map(([pointer, keywords]) => {
    const names = [...keywords];
    const message = names.length
      ? `violates the OpenAPI ${version} schema (${names.join(", ")})`
      : `violates the OpenAPI ${version} schema`;
    return { pointer, keywords: names, message };
  });
}

// Lazily import Hyperjump (and register both OAS dialects) exactly once.
let validatorPromise: Promise<{
  validate: (uri: string, instance: unknown, format: string) => Promise<unknown>;
  BASIC: string;
}> | null = null;

function loadValidator(): NonNullable<typeof validatorPromise> {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      const oas31 = await import("@hyperjump/json-schema/openapi-3-1");
      await import("@hyperjump/json-schema/openapi-3-2"); // registers the 3.2 dialect + schemas
      const { BASIC } = await import("@hyperjump/json-schema/experimental");
      return { validate: oas31.validate as never, BASIC };
    })();
  }
  return validatorPromise;
}

/**
 * Validate a parsed document against the OpenAPI schema for its version, choosing the entry schema
 * from its declared Schema-Object dialect. Returns located violations (empty ⇒ valid) plus an
 * optional warning when Schema Objects could not be validated (unsupported dialect).
 */
export async function validateOad(
  value: unknown,
  root: TreeNode,
  version: VersionFamily,
): Promise<ValidationResult> {
  const { entryUri, dialectWarning } = selectValidationSchema(
    documentDialect(value),
    schemaObjectDialects(root),
    version,
  );

  const { validate, BASIC } = await loadValidator();
  const output = (await validate(entryUri, value, BASIC)) as BasicOutput;

  const violations = output.valid ? [] : toViolations(output, version);
  return { violations, dialectWarning };
}
