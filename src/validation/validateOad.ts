// Validate a loaded document against the official OpenAPI JSON Schema, offline.
//
// `@hyperjump/json-schema` pre-loads the OAS 3.1/3.2 schemas and the JSON Schema draft meta-schemas
// (04/06/07/2019-09/2020-12), so nothing is fetched at runtime. Validation has two parts:
//
//  1. Envelope — the whole document is validated against the loose OAS `schema` (Schema Objects are
//     only checked to be object/boolean), covering the OpenAPI structure.
//  2. Per-resource Schema Objects — each top-most Schema Object is meta-validated against the
//     dialect it actually declares (its `$schema`, else the document's `jsonSchemaDialect`, else the
//     OAS dialect). We instance-validate the Schema Object against that dialect's meta-schema, which
//     — unlike compiling it as a schema — never resolves the Schema Object's own `$ref`s, so a
//     document with broken/external references still validates.
//
// The Hyperjump import is dynamic so the validator + schemas land in a lazily-loaded chunk.

import type { DocKind, TreeNode, VersionFamily } from "../types";
import { displayPointer, valueAtPointer } from "../model/jsonPointer";
import { dialectLabel, isOasDialect, normalizeDialect, oasDialectUri } from "../oas/dialects";

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
  /** Present when one or more Schema Objects use a dialect this tool can't validate (skipped). */
  dialectWarning?: string;
}

/** The document-level `jsonSchemaDialect`, if present and a string. */
function documentDialect(value: unknown): string | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const d = (value as Record<string, unknown>)["jsonSchemaDialect"];
    if (typeof d === "string") return d;
  }
  return undefined;
}

/** The top-most Schema Object nodes — each is a resource we hand to the validator as a unit. */
function topSchemaObjects(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const visit = (node: TreeNode): void => {
    if (node.oasType === "Schema Object") {
      out.push(node); // don't descend: nested schemas validate as part of this one
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}

/** The dialect a Schema Object declares (its `$schema`), else the document/version default. */
function declaredDialect(node: TreeNode, docDefault: string | undefined): string | undefined {
  const own = node.children.find((c) => c.key === "$schema");
  return own && own.valueKind === "string" ? (own.scalarValue as string) : docDefault;
}

/** Map a declared dialect to the registered meta-schema URI to validate against (OAS → base alias). */
function metaSchemaUri(declared: string | undefined, version: VersionFamily): string {
  if (declared === undefined || isOasDialect(declared, version)) return oasDialectUri(version);
  return normalizeDialect(declared);
}

// Applicator / structural keywords carry no useful "what's wrong here" signal in a message.
const NOISE_KEYWORDS = new Set([
  "ref",
  "dynamicRef",
  "anyOf",
  "allOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "properties",
  "additionalProperties",
  "patternProperties",
  "items",
  "prefixItems",
  "contains",
  "dependentSchemas",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
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

/**
 * Map Hyperjump's BASIC output into located, de-duplicated violations. `subject` names the schema the
 * value failed (e.g. "OpenAPI 3.1", or a JSON Schema dialect label); `prefix` is the JSON Pointer of
 * the validated subtree within the document ("" for the whole-document envelope pass).
 */
function toViolations(output: BasicOutput, subject: string, prefix: string): SchemaViolation[] {
  const byPointer = new Map<string, Set<string>>();
  for (const unit of output.errors ?? []) {
    if (unit.instanceLocation === undefined) continue;
    const pointer = prefix + unit.instanceLocation.replace(/^#/, "");
    const keyword = (unit.absoluteKeywordLocation ?? unit.keyword ?? "").split("/").pop() ?? "";
    const set = byPointer.get(pointer) ?? byPointer.set(pointer, new Set()).get(pointer)!;
    if (keyword && !NOISE_KEYWORDS.has(keyword) && !/^\d+$/.test(keyword)) set.add(keyword);
  }
  if (byPointer.size === 0) {
    return [
      { pointer: prefix, keywords: [], message: `does not conform to the ${subject} schema` },
    ];
  }
  return [...byPointer].map(([pointer, keywords]) => {
    const names = [...keywords];
    const message = names.length
      ? `violates the ${subject} schema (${names.join(", ")})`
      : `violates the ${subject} schema`;
    return { pointer, keywords: names, message };
  });
}

// Lazily import Hyperjump (registering every dialect we validate against) exactly once.
let validatorPromise: Promise<{
  validate: (uri: string, instance: unknown, format: string) => Promise<unknown>;
  hasSchema: (uri: string) => boolean;
  BASIC: string;
}> | null = null;

function loadValidator(): NonNullable<typeof validatorPromise> {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      const oas31 = await import("@hyperjump/json-schema/openapi-3-1");
      await import("@hyperjump/json-schema/openapi-3-0"); // OAS 3.0 schema (one self-contained schema)
      await import("@hyperjump/json-schema/openapi-3-2"); // OAS 3.2 dialect + schemas
      // Register the JSON Schema draft meta-schemas so a Schema Object can be validated against the
      // dialect it declares (2020-12 comes via the openapi modules).
      await import("@hyperjump/json-schema/draft-04");
      await import("@hyperjump/json-schema/draft-06");
      await import("@hyperjump/json-schema/draft-07");
      await import("@hyperjump/json-schema/draft-2019-09");
      const { BASIC } = await import("@hyperjump/json-schema/experimental");
      return { validate: oas31.validate as never, hasSchema: oas31.hasSchema as never, BASIC };
    })();
  }
  return validatorPromise;
}

/**
 * Validate a parsed document against the OpenAPI schema for its version: the envelope structure plus
 * each Schema Object against its own declared dialect. Returns located violations (empty ⇒ valid)
 * plus an optional warning when a Schema Object's dialect could not be validated.
 */
export async function validateOad(
  value: unknown,
  root: TreeNode,
  version: VersionFamily,
  kind: DocKind = "openapi",
  versionDetermined: boolean = true,
): Promise<ValidationResult> {
  const { validate, hasSchema, BASIC } = await loadValidator();
  const docDefault = documentDialect(value);
  const violations: SchemaViolation[] = [];
  const unvalidated: string[] = [];

  // 1. Envelope structure. OpenAPI documents only: a standalone JSON Schema document has no OpenAPI
  //    envelope — it is validated entirely in step 2. For 3.1/3.2 the envelope treats Schema Objects
  //    loosely (object/boolean) and step 2 meta-validates each against its dialect; for 3.0 — whose
  //    Schema Objects are not JSON Schema — the single 3.0 schema validates them fully here, so step 2
  //    is skipped for it.
  if (kind === "openapi") {
    // `version` is the minor-release family (e.g. "3.1"); one schema validates every patch of a
    // minor version. `versionFamilyOf` in loader.ts explains why the patch level is dropped (and
    // why the dated revisions in schema URLs are not patch releases).
    const envelope = (await validate(
      `https://spec.openapis.org/oas/${version}/schema`,
      value,
      BASIC,
    )) as BasicOutput;
    if (!envelope.valid) violations.push(...toViolations(envelope, `OpenAPI ${version}`, ""));
  }

  // 2. Each top-most Schema Object against the dialect it declares (3.1/3.2 and standalone JSON Schema
  //    documents only — an OpenAPI 3.0 doc's schemas are covered by the envelope in step 1). For a
  //    schema document that is the root itself; a `$schema`-less root borrows the OAS dialect, unless no
  //    OAS version was determinable (no OpenAPI document in the OAD) — then it is left unvalidated.
  if (kind === "schema" || version !== "3.0") {
    for (const node of topSchemaObjects(root)) {
      const declared = declaredDialect(node, docDefault);
      // A standalone JSON Schema document with no own `$schema` borrows the OAS dialect — but only when
      // one exists: not when the version is undetermined, and not for 3.0 (3.0 has no JSON Schema dialect).
      if (
        kind === "schema" &&
        declared === undefined &&
        (!versionDetermined || version === "3.0")
      ) {
        unvalidated.push(`${displayPointer(node.id)} (dialect undetermined)`);
        continue;
      }
      const uri = metaSchemaUri(declared, version);
      if (!hasSchema(uri)) {
        unvalidated.push(`${displayPointer(node.id)} (dialect ${declared})`);
        continue;
      }
      const subject =
        kind === "schema" ? dialectLabel(declared ?? oasDialectUri(version)) : `OpenAPI ${version}`;
      const out = (await validate(uri, valueAtPointer(value, node.id), BASIC)) as BasicOutput;
      if (!out.valid) violations.push(...toViolations(out, subject, node.id));
    }
  }

  const dialectWarning =
    unvalidated.length > 0
      ? `Schema Objects using a dialect this tool can't validate were skipped: ${unvalidated.join(", ")}.`
      : undefined;
  return { violations, dialectWarning };
}
