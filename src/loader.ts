// Load a single document of an OAD in two phases. `detectDocument` acquires the text (URL fetch or
// supplied upload text), parses it, and decides whether its root is an OpenAPI Object or a standalone
// JSON Schema. `finalizeDocument` then classifies + validates it against the OAD's version family —
// which is only known after every document is detected (a JSON Schema document has no intrinsic OAS
// version). Either phase produces a typed error on failure.

import type { DocKind, OadDocument, TreeNode, VersionFamily } from "./types";
import {
  InvalidDocumentError,
  NotOpenApiError,
  ResourceLimitError,
  RetrievalError,
  SchemaValidationError,
  UnsupportedVersionError,
  VersionMismatchError,
  errorMessage,
} from "./errors";
import { defaultLimits, formatBytes, type Limits } from "./limits";
import { parseDocument } from "./parse/detectFormat";
import { buildTree } from "./model/treeBuilder";
import { classifyDocument } from "./oas/classify";
import { annotateDialectSupport, oasDialectUri } from "./oas/dialects";
import { displayPointer } from "./model/jsonPointer";
import { validateOad, type SchemaViolation } from "./validation/validateOad";

/** A locally-uploaded document; the file has already been read to text. */
export interface UploadInput {
  source: "upload";
  filename: string;
  text: string;
  /**
   * Path of the file relative to a chosen folder (its `webkitRelativePath`), when the
   * file came from a directory upload. Used — in preference to the bare file name — to
   * build the `file://` base URI so subdirectory-relative references line up.
   */
  relativePath?: string;
  /** Optional URL the file was originally retrieved from (its base URI). */
  retrievalUri?: string;
  isEntry: boolean;
}

/** A document to be fetched from a URL (which becomes its retrieval/base URI). */
export interface UrlInput {
  source: "url";
  url: string;
  /**
   * Base URI to record for this document, when it differs from the fetch `url`. Lets a document
   * served from one location (e.g. a same-origin `/fixtures/…` demo file) declare the base URI it
   * would have if served from its real home, so relative cross-document references resolve there.
   */
  retrievalUri?: string;
  isEntry: boolean;
}

export type DocInput = UploadInput | UrlInput;

/**
 * A document after detection (phase 1): its text is parsed, its structural tree is built, and its
 * kind is known, but it is not yet classified or validated (that needs the OAD's version family).
 */
export interface DetectedDoc {
  kind: DocKind;
  source: "upload" | "url";
  isEntry: boolean;
  filename?: string;
  retrievalUri?: string;
  /** OAS 3.2 `$self` (OpenAPI documents only). */
  selfUri?: string;
  format: "json" | "yaml";
  raw: string;
  value: unknown;
  /** The structural tree, not yet classified. */
  root: TreeNode;
  /** The root `openapi` version string (OpenAPI documents only). */
  oasVersion?: string;
  /** The root `$schema` value, if a string (JSON Schema documents only). */
  rootSchema?: string;
}

let nextDocId = 1;

/** Map a full version string ("3.2.0") to its family ("3.2"). Assumes 3.0/3.1/3.2. */
export function versionFamilyOf(version: string): VersionFamily {
  if (version.startsWith("3.0")) return "3.0";
  return version.startsWith("3.2") ? "3.2" : "3.1";
}

/**
 * The OAS version family an OAD uses, taken from its OpenAPI documents (a JSON Schema document has
 * none of its own). `determined` is false when there is no OpenAPI document to set it — then a default
 * of "3.1" is returned for machinery that needs a value, but a `$schema`-less JSON Schema document is
 * left unvalidated rather than validated against a guessed dialect. Throws when versions are mixed.
 */
export function determineVersionFamily(
  docs: { kind: DocKind; oasVersion?: string }[],
): { family: VersionFamily; determined: boolean } {
  const families = new Set(
    docs
      .filter((d) => d.kind === "openapi" && d.oasVersion !== undefined)
      .map((d) => versionFamilyOf(d.oasVersion!)),
  );
  if (families.size > 1) {
    throw new VersionMismatchError(
      "This OAD mixes OAS versions, which is not supported. Use a single version family " +
        "(all 3.0, all 3.1, or all 3.2).",
    );
  }
  const [family] = families;
  return { family: family ?? "3.1", determined: families.size === 1 };
}

/**
 * Phase 1: acquire, parse, build the tree, and detect the document kind. `limits` caps the source
 * size, tree depth, and node count, refusing an oversized/over-deep document before parse and build
 * spend resources on it (the "Load anyway" override passes lifted limits).
 */
export async function detectDocument(
  input: DocInput,
  fragmentsEnabled = false,
  limits: Limits = defaultLimits,
): Promise<DetectedDoc> {
  let text: string;
  let filename: string | undefined;
  let retrievalUri: string | undefined;

  if (input.source === "url") {
    text = await fetchText(input.url, limits);
    retrievalUri = input.retrievalUri?.trim() || input.url;
    filename = filenameFromUrl(input.url);
  } else {
    text = input.text;
    filename = input.filename;
    assertWithinByteCap(text.length, limits);
    // With no provided retrieval URL, fall back to a file:// URL built from the file's
    // path. A directory upload gives a relative path (e.g. `oad/schemas/pet.yaml`) so
    // subdirectory-relative references resolve; a single-file upload only exposes the
    // basename. Either way sibling files line up the way they would when served over HTTP.
    retrievalUri = input.retrievalUri?.trim() || fileUriFrom(input.relativePath ?? input.filename);
  }

  const { value, format } = parseDocument(text, filename);
  const detected = detectKind(value, fragmentsEnabled);
  const root = buildTree(value, limits);

  return {
    kind: detected.kind,
    source: input.source,
    isEntry: input.isEntry,
    filename,
    retrievalUri,
    selfUri: detected.selfUri,
    format,
    raw: text,
    value,
    root,
    oasVersion: detected.oasVersion,
    rootSchema: detected.rootSchema,
  };
}

/**
 * Phase 2: classify and validate a detected document against the OAD's version family. An OpenAPI
 * document validates against its envelope + Schema-Object dialects; a JSON Schema document validates
 * its single Schema Object against its `$schema`, else the borrowed OAS dialect (or is left unvalidated
 * when no version was determined). Throws a typed error on a structural/schema failure.
 */
export async function finalizeDocument(
  d: DetectedDoc,
  family: VersionFamily,
  versionDetermined: boolean,
): Promise<OadDocument> {
  let schemaDialect: string | undefined;
  let dialectWarning: string | undefined;

  // A fragment is intentionally left unclassified and unvalidated here — its root type isn't known
  // until references are resolved, so `typeFragments` classifies it later. OpenAPI / JSON Schema
  // documents classify and validate now, against the OAD's version family.
  if (d.kind !== "fragment") {
    classifyDocument(d.root, family, d.kind);
    // OAS 3.0 Schema Objects are not JSON Schema — there is no `$schema`/`jsonSchemaDialect` to flag.
    if (family !== "3.0") annotateDialectSupport(d.root, family);
    if (d.kind === "openapi") assertValidLinks(d.root, d.oasVersion!);

    // The effective dialect a JSON Schema document validates/resolves against: its own `$schema`, else
    // the borrowed OAS dialect, else undefined (no version determined, or a 3.0 OAD that has no JSON
    // Schema dialect to borrow ⇒ left unvalidated).
    schemaDialect =
      d.kind === "schema"
        ? (d.rootSchema ?? (versionDetermined && family !== "3.0" ? oasDialectUri(family) : undefined))
        : undefined;

    // Validate (offline). A structural failure rejects the document; an unsupported / undetermined
    // Schema-Object dialect is a non-blocking warning carried on the doc.
    const result = await validateOad(d.value, d.root, family, d.kind, versionDetermined);
    if (result.violations.length > 0) {
      const subject = d.kind === "schema" ? "JSON Schema" : `OpenAPI ${d.oasVersion}`;
      throw new SchemaValidationError(schemaErrorMessage(subject, result.violations), result.violations);
    }
    dialectWarning = result.dialectWarning;
  }

  return {
    id: `doc-${nextDocId++}`,
    isEntry: d.isEntry,
    source: d.source,
    filename: d.filename,
    retrievalUri: d.retrievalUri,
    selfUri: d.selfUri,
    format: d.format,
    raw: d.raw,
    value: d.value,
    kind: d.kind,
    oasVersion: d.oasVersion,
    schemaDialect,
    schemaDialectWarning: dialectWarning,
    root: d.root,
  };
}

/**
 * Load a single document end to end (detect + finalize), using only its own OAS version. Convenience
 * for callers handling one document at a time; the multi-document pipeline detects every document
 * first so a JSON Schema document can borrow the version family from an OpenAPI sibling.
 */
export async function loadDocument(input: DocInput): Promise<OadDocument> {
  const detected = await detectDocument(input);
  const { family, determined } = determineVersionFamily([detected]);
  return finalizeDocument(detected, family, determined);
}

/** A readable multi-line message listing the located schema violations (capped). */
function schemaErrorMessage(subject: string, violations: SchemaViolation[]): string {
  const MAX = 20;
  const lines = violations
    .slice(0, MAX)
    .map((v) => `  • ${displayPointer(v.pointer)} — ${v.message}`);
  if (violations.length > MAX) lines.push(`  …and ${violations.length - MAX} more`);
  return (
    `Not a valid ${subject} document: ${violations.length} schema ` +
    `violation${violations.length === 1 ? "" : "s"}.\n${lines.join("\n")}`
  );
}

/**
 * Reject structurally-invalid Link Objects before the tree is built into an OAD. A Link must
 * use exactly one of `operationRef` / `operationId`; setting both is invalid OpenAPI, so the
 * document is rejected (surfaced like an invalid-YAML error) rather than rendered.
 */
function assertValidLinks(root: TreeNode, oasVersion: string): void {
  const visit = (node: TreeNode): void => {
    if (
      node.oasType === "Link Object" &&
      node.children.some((c) => c.key === "operationRef") &&
      node.children.some((c) => c.key === "operationId")
    ) {
      throw new InvalidDocumentError(
        `Not a valid OpenAPI ${oasVersion} document: the Link Object at ${displayPointer(node.id)} ` +
          `sets both operationRef and operationId, but a Link must use exactly one.`,
      );
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
}

/**
 * Decide a parsed document's kind. A `$id` and/or `$schema` at the root marks a JSON Schema document
 * (draft-04's bare `id` is too generic to be a reliable signal — those go unrecognized for now); a
 * string `openapi` marks a complete OpenAPI document. Anything else is neither — a load error, unless
 * `fragmentsEnabled` is on, when an object-rooted unrecognized document becomes a `"fragment"` (its
 * type is inferred later from the references that point at it).
 */
function detectKind(
  value: unknown,
  fragmentsEnabled: boolean,
): {
  kind: DocKind;
  oasVersion?: string;
  selfUri?: string;
  rootSchema?: string;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new NotOpenApiError(
      "Document root is not a JSON/YAML object, so it is neither an OpenAPI document, a JSON Schema " +
        "document, nor a supported fragment.",
    );
  }
  const obj = value as Record<string, unknown>;

  // JSON Schema document — checked first, so a `$schema`/`$id` root is never mistaken for OpenAPI.
  if ("$id" in obj || "$schema" in obj) {
    const rootSchema = typeof obj["$schema"] === "string" ? (obj["$schema"] as string) : undefined;
    return { kind: "schema", rootSchema };
  }

  // Complete OpenAPI document.
  const openapi = obj["openapi"];
  if (typeof openapi === "string") {
    if (!/^3\.(0|1|2)(\.|$)/.test(openapi)) {
      throw new UnsupportedVersionError(
        `Unsupported OpenAPI version "${openapi}". This tool supports OAS 3.0, 3.1, and 3.2.`,
      );
    }
    const self = obj["$self"];
    const selfUri = typeof self === "string" ? self : undefined;
    return { kind: "openapi", oasVersion: openapi, selfUri };
  }

  // A document fragment — accepted only when fragments are enabled; typed later from incoming references.
  if (fragmentsEnabled) return { kind: "fragment" };

  throw new NotOpenApiError(
    "No `openapi` field and no `$id`/`$schema` — this is neither an OpenAPI document nor a " +
      "(recognized) JSON Schema document. Enable document fragments to load it anyway.",
  );
}

async function fetchText(url: string, limits: Limits): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (e) {
    throw new RetrievalError(
      `Could not fetch ${url}: ${errorMessage(e)} (network error or blocked by CORS).`,
    );
  }
  if (!res.ok) {
    throw new RetrievalError(`Could not fetch ${url}: HTTP ${res.status} ${res.statusText}.`);
  }
  // Reject on the advertised size before materializing the body, when the server provides it.
  const advertised = Number(res.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > 0) assertWithinByteCap(advertised, limits);
  const text = await res.text();
  assertWithinByteCap(text.length, limits);
  return text;
}

/** Refuse a document whose source exceeds the byte cap (UTF-16 code units ≈ bytes for JSON/YAML). */
function assertWithinByteCap(size: number, limits: Limits): void {
  if (size > limits.maxBytes) {
    throw new ResourceLimitError(
      "bytes",
      `Document is too large (~${formatBytes(size)}; limit is ${formatBytes(limits.maxBytes)}).`,
    );
  }
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url, window.location.href).pathname;
    const segment = path.split("/").filter(Boolean).pop();
    return segment || undefined;
  } catch {
    return undefined;
  }
}

/** Build a `file://` base URI from an uploaded file's path (basename or relative path). */
function fileUriFrom(path: string): string {
  try {
    return new URL(path, "file:///").href;
  } catch {
    return `file:///${encodeURIComponent(path)}`;
  }
}
