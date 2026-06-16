// Load a single document of an OAD: acquire its text (URL fetch or supplied upload
// text), parse it, validate that it is a supported OpenAPI document, build and
// classify its tree. Produces an OadDocument or throws a typed error.

import type { OadDocument, VersionFamily } from "./types";
import {
  NotOpenApiError,
  RetrievalError,
  UnsupportedVersionError,
  errorMessage,
} from "./errors";
import { parseDocument } from "./parse/detectFormat";
import { buildTree } from "./model/treeBuilder";
import { classifyDocument } from "./oas/classify";

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
  isEntry: boolean;
}

export type DocInput = UploadInput | UrlInput;

let nextDocId = 1;

/** Map a full version string ("3.2.0") to its family ("3.2"). Assumes 3.1/3.2. */
export function versionFamilyOf(version: string): VersionFamily {
  return version.startsWith("3.2") ? "3.2" : "3.1";
}

export async function loadDocument(input: DocInput): Promise<OadDocument> {
  let text: string;
  let filename: string | undefined;
  let retrievalUri: string | undefined;

  if (input.source === "url") {
    text = await fetchText(input.url);
    retrievalUri = input.url;
    filename = filenameFromUrl(input.url);
  } else {
    text = input.text;
    filename = input.filename;
    // With no provided retrieval URL, fall back to a file:// URL built from the file's
    // path. A directory upload gives a relative path (e.g. `oad/schemas/pet.yaml`) so
    // subdirectory-relative references resolve; a single-file upload only exposes the
    // basename. Either way sibling files line up the way they would when served over HTTP.
    retrievalUri = input.retrievalUri?.trim() || fileUriFrom(input.relativePath ?? input.filename);
  }

  const { value, format } = parseDocument(text, filename);
  const { oasVersion, selfUri } = validateOpenApi(value);

  const root = buildTree(value);
  classifyDocument(root, versionFamilyOf(oasVersion));

  return {
    id: `doc-${nextDocId++}`,
    isEntry: input.isEntry,
    source: input.source,
    filename,
    retrievalUri,
    selfUri,
    format,
    raw: text,
    value,
    oasVersion,
    root,
  };
}

/** Validate that a parsed value is a supported OpenAPI Object; extract version + $self. */
function validateOpenApi(value: unknown): { oasVersion: string; selfUri?: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new NotOpenApiError(
      "Document root is not a JSON/YAML object, so it cannot be an OpenAPI Object.",
    );
  }
  const obj = value as Record<string, unknown>;

  const openapi = obj["openapi"];
  if (typeof openapi !== "string") {
    throw new NotOpenApiError(
      "Missing or non-string `openapi` field — this is not an OpenAPI document.",
    );
  }
  if (!/^3\.(1|2)(\.|$)/.test(openapi)) {
    throw new UnsupportedVersionError(
      `Unsupported OpenAPI version "${openapi}". This tool supports OAS 3.1 and 3.2.`,
    );
  }

  const self = obj["$self"];
  const selfUri = typeof self === "string" ? self : undefined;
  return { oasVersion: openapi, selfUri };
}

async function fetchText(url: string): Promise<string> {
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
  return res.text();
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
