// Types and pure helpers for the OAD input form. The form itself is OadForm.svelte;
// the framework-agnostic bits (outcome shape, folder-name handling, entry choice) live
// here so they stay unit-testable.

export interface RenderOutcome {
  ok: boolean;
  /** Per-row errors keyed by the row's index in the submitted input list. */
  rowErrors?: Record<number, string>;
  /** An OAD-level error (currently only version mismatch). */
  oadError?: string;
}

/** A file read from a directory upload, carrying its path relative to the folder. */
export interface FolderDoc {
  filename: string;
  relativePath: string;
  text: string;
  /** Retrieval URI when a folder base URL was supplied (overrides the file:// base). */
  retrievalUri?: string;
}

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
