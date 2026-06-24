// Resource guards: refuse a document that is too large or too deeply nested *before* the pipeline
// (parse → buildTree → classify → validate → resolve → render) spends time or memory on it. Everything
// downstream walks the tree recursively with no depth bound, so a single depth+node guard at build time
// keeps every later stage safe from a frozen tab or an uncaught stack overflow.
//
// The caps deliberately sit below GitHub-scale single-file descriptions: such a document is cleanly
// refused (with an explicit "Load anyway" override) rather than hung on. They are plain constants so
// they are easy to find, test, and retune as the renderer gains the ability to handle bigger inputs.

/** ~8 MB of source text per document — a cheap early gate before parsing. */
export const MAX_DOC_BYTES = 8 * 1024 * 1024;

/**
 * Maximum nesting depth. Real OADs nest well under ~40 levels (deep schema recursion is expressed with
 * `$ref`, which does not nest structurally), so 128 never refuses a legitimate document. The ceiling is
 * set by the deepest downstream recursion, not by `buildTree` itself: schema validation (Hyperjump)
 * overflows the call stack somewhere around ~400 levels — and that floor is jittery and engine-dependent
 * — so 128 keeps a ~3× safety margin below it. Capping here means no later stage ever recurses past 128.
 */
export const MAX_TREE_DEPTH = 128;

/** Maximum total nodes in one document's structural tree — the decisive backstop against a huge but
 *  shallow document (every key and array element is a node). */
export const MAX_TREE_NODES = 150_000;

/** The three caps, grouped so they can be passed as a unit and lifted together for "Load anyway". */
export interface Limits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
}

/** The caps enforced by default. */
export const defaultLimits: Limits = {
  maxBytes: MAX_DOC_BYTES,
  maxDepth: MAX_TREE_DEPTH,
  maxNodes: MAX_TREE_NODES,
};

/** All caps lifted — used by the "Load anyway" override, where the user accepts the risk of a slow or
 *  unresponsive tab. */
export const noLimits: Limits = {
  maxBytes: Infinity,
  maxDepth: Infinity,
  maxNodes: Infinity,
};

/** A human size like "14 MB" / "812 KB" for limit messages, from a byte count. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
