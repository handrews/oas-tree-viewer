// Resource guards run *before* the pipeline (parse → buildTree → classify → validate → resolve → render)
// spends time or memory on a document. The pipeline now runs in a Web Worker (so it can't freeze the tab)
// and the renderer windows the tree (so size no longer hangs it), which is why the byte and node caps are
// lifted by default below — GitHub- and Stripe-scale single-file descriptions load without a prompt. Only
// the *depth* cap is still enforced by default, because it guards a real crash, not just slowness.

/**
 * Maximum nesting depth. Real OADs nest well under ~40 levels (deep schema recursion is expressed with
 * `$ref`, which does not nest structurally), so 128 never refuses a legitimate document. The ceiling is
 * set by the deepest downstream recursion, not by `buildTree` itself: schema validation (Hyperjump)
 * overflows the call stack somewhere around ~400 levels — and that floor is jittery and engine-dependent
 * — so 128 keeps a ~3× safety margin below it. Capping here means no later stage ever recurses past 128.
 */
export const MAX_TREE_DEPTH = 128;

// Render-interaction guard. "Expand all" is windowed (only the rows near the viewport are ever mounted, the
// rest tracked analytically), so it no longer needs a guard. "Show all references" still draws every
// reference arc at once, so it stays gated — independent of the load caps above, so it remains active even
// after a "Load anyway" override.

/** Above this many reference arcs, "Show all references" confirms before drawing them all at once. */
export const MAX_RENDER_EDGES = 2_000;

/** The three caps, grouped so they can be passed as a unit and lifted together for "Load anyway". The byte
 *  and node fields are still honored by `buildTree` / `fetchText` when a finite value is supplied (used in
 *  tests), but are unbounded by default — see {@link defaultLimits}. */
export interface Limits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
}

/** The caps enforced by default: only nesting depth (the crash guard). Byte and node counts are unbounded —
 *  the off-thread pipeline and the windowed renderer handle large documents, so they no longer warrant a
 *  "too large" refusal. */
export const defaultLimits: Limits = {
  maxBytes: Infinity,
  maxDepth: MAX_TREE_DEPTH,
  maxNodes: Infinity,
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
