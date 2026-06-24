// Types and pure helpers for the OAD input form. The form itself is OadForm.svelte;
// the framework-agnostic bits (outcome shape, folder-name handling, entry choice,
// and the row → DocInput[] expansion) live here so they stay unit-testable.

import type { DocInput } from "../loader";

export interface RenderOutcome {
  ok: boolean;
  /** Per-row errors keyed by the row's index in the submitted input list. */
  rowErrors?: Record<number, string>;
  /** An OAD-level error (currently only version mismatch). */
  oadError?: string;
  /** True when the failure was a resource guard (too large / deep / many nodes), so the form can
   *  offer a "Load anyway" retry that lifts the limits. */
  limited?: boolean;
  /** True when the user cancelled the load before it finished — neither success nor an error, so the
   *  form should just clear its busy state and show nothing. */
  cancelled?: boolean;
}

/** Options for a render request. `enforceLimits: false` is the "Load anyway" override. */
export interface RenderOptions {
  enforceLimits?: boolean;
}

/** A file read from a directory upload, carrying its path relative to the folder. */
export interface FolderDoc {
  filename: string;
  relativePath: string;
  text: string;
  /** Retrieval URI when a folder base URL was supplied (overrides the file:// base). */
  retrievalUri?: string;
}

/**
 * The local part of a document row: nothing, a single file, or a whole directory (a
 * bundle of documents with one chosen as the entry). The row may also carry a URL,
 * whose meaning depends on this kind (see {@link urlFieldLabel} / {@link rowToInputs}).
 */
export type LocalSource =
  | { kind: "none" }
  | { kind: "file"; filename: string; text: string }
  | { kind: "dir"; folderName: string; docs: FolderDoc[]; entryIndex: number };

/** Filenames that look like OpenAPI documents (JSON/YAML). */
export const DOC_FILE = /\.(json|ya?ml)$/i;

/**
 * Map a file's folder-relative path onto a supplied base URL, standing in for the implicit
 * `file://<folder>/` base. `webkitRelativePath` is prefixed with the chosen folder's name,
 * which is stripped so the base URL corresponds to that folder. Returns undefined if the
 * base URL can't be used (e.g. it is not absolute).
 */
export function rebaseFolderUri(relativePath: string, baseUrl: string): string | undefined {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const withinFolder = relativePath.split("/").slice(1).join("/") || relativePath;
  try {
    return new URL(withinFolder, base).href;
  } catch {
    return undefined;
  }
}

/** Choose the entry: a conventionally-named file, else the shallowest path. */
export function pickEntryIndex(items: FolderDoc[]): number {
  const conventional = items.findIndex((it) => /^openapi\.(ya?ml|json)$/i.test(it.filename));
  if (conventional >= 0) return conventional;
  let best = 0;
  items.forEach((it, i) => {
    if (it.relativePath.split("/").length < items[best]!.relativePath.split("/").length) best = i;
  });
  return best;
}

/** The folder name a directory upload was rooted at (the first path segment). */
export function folderNameOf(relativePath: string): string {
  return relativePath.split("/")[0] || relativePath;
}

/** Keep only the OpenAPI-looking files from a directory selection, shaped as FolderDocs. */
export function dirDocsFromFiles(
  files: { filename: string; relativePath: string; text: string }[],
): FolderDoc[] {
  return files
    .filter((f) => DOC_FILE.test(f.filename))
    .map((f) => ({ filename: f.filename, relativePath: f.relativePath, text: f.text }));
}

/** Build a directory LocalSource from a folder's files: keep the OAS docs, default the entry. */
export function dirLocalSource(
  files: { filename: string; relativePath: string; text: string }[],
): Extract<LocalSource, { kind: "dir" }> {
  const docs = dirDocsFromFiles(files);
  const folderName = files.length ? folderNameOf(files[0]!.relativePath) : "";
  const entryIndex = docs.length ? pickEntryIndex(docs) : 0;
  return { kind: "dir", folderName, docs, entryIndex };
}

/** Label/placeholder for the per-row URL field, which adapts to the local source. */
export function urlFieldLabel(kind: LocalSource["kind"]): string {
  switch (kind) {
    case "file":
      return "Retrieval URL (optional — base URI this file came from)";
    case "dir":
      return "Base URL (optional — maps the folder onto a server path)";
    default:
      return "Document URL to fetch";
  }
}

/** Either the DocInputs a row expands to, or a presence/validation error for that row. */
export type RowInputs = { inputs: DocInput[] } | { error: string };

/**
 * Expand one form row into the DocInput(s) it represents. A single file or a URL is one
 * input; a directory is one input per document, the chosen entry first. `isRowEntry` marks
 * whether this row holds the OAD's entry document (only the row's entry doc gets it).
 */
export function rowToInputs(local: LocalSource, url: string, isRowEntry: boolean): RowInputs {
  const trimmedUrl = url.trim();

  if (local.kind === "none") {
    if (!trimmedUrl) return { error: "Add a file or folder, or enter a URL to fetch." };
    return { inputs: [{ source: "url", url: trimmedUrl, isEntry: isRowEntry }] };
  }

  if (local.kind === "file") {
    return {
      inputs: [
        {
          source: "upload",
          filename: local.filename,
          text: local.text,
          retrievalUri: trimmedUrl || undefined,
          isEntry: isRowEntry,
        },
      ],
    };
  }

  // Directory: entry document first, then the rest (preserving order).
  const { docs, entryIndex } = local;
  if (docs.length === 0) {
    return { error: "No OpenAPI documents (.json/.yaml) found in this folder." };
  }
  const ordered = [docs[entryIndex]!, ...docs.filter((_, i) => i !== entryIndex)];
  const inputs: DocInput[] = ordered.map((doc, i) => ({
    source: "upload",
    filename: doc.filename,
    text: doc.text,
    relativePath: doc.relativePath,
    retrievalUri: trimmedUrl ? rebaseFolderUri(doc.relativePath, trimmedUrl) : undefined,
    isEntry: isRowEntry && i === 0,
  }));
  return { inputs };
}
