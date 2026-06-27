// Pure geometry helpers for the document-tree renderer (treeView.ts / canvas.ts). Kept free of d3 and the
// DOM so the math is node-testable; the SVG islands that consume it are coverage-excluded and verified in
// the browser. The first of these, `estimateLabelWidth`, replaces a per-row `getBBox()` measurement — the
// O(N) forced reflow that made "Expand all" freeze — and lets a row's label end be known even when the row
// is not mounted (so reference arcs can still anchor to off-screen nodes).

/** Label font size (px), matching `.node-label` in styles.css. */
const LABEL_FONT_PX = 12;
/** The hidden-child "(+N)" count tspan font size (px), matching `.node-label .count`. */
const COUNT_FONT_PX = 10;
/**
 * Average glyph advance as a fraction of the font size for the proportional label font. Deliberately a
 * touch generous so the estimate is an *over*-estimate of the true width: right-gutter status markers
 * (placed just past the label) then never overlap the text, and a reference arc leaves from just clear of
 * the label rather than from inside it.
 */
const AVG_ADVANCE = 0.6;

/** Horizontal gap (px) before the "(+N)" count tspan — the `dx` treeView gives it. */
export const COUNT_DX = 6;
/** Horizontal gap (px) before the secondary (type/value) tspan. */
export const SECONDARY_DX = 8;
/** The secondary tspan is truncated to this many characters in the label. */
export const SECONDARY_MAX = 48;

/**
 * Estimate the rendered width (px) of a tree row's label: the `key` tspan, an optional "(+N)" hidden-child
 * count, and an optional secondary (type/value) tspan, including the gaps between them. The secondary is
 * truncated to {@link SECONDARY_MAX} characters, mirroring the label itself. The result is rounded up so it
 * stays an over-estimate.
 */
export function estimateLabelWidth(
  primary: string,
  secondary: string,
  hiddenCount: number,
): number {
  const adv = LABEL_FONT_PX * AVG_ADVANCE;
  let width = primary.length * adv;
  if (hiddenCount > 0) {
    const count = `(+${hiddenCount})`;
    width += COUNT_DX + count.length * COUNT_FONT_PX * AVG_ADVANCE;
  }
  if (secondary) {
    width += SECONDARY_DX + Math.min(secondary.length, SECONDARY_MAX) * adv;
  }
  return Math.ceil(width);
}

// --- Right-gutter occupant placement -------------------------------------------------------------
// Past a row's measured label end sit, left to right: the reference-arc source (placed by the canvas,
// unconditionally, since it's just where a line leaves the row), then the glyphs this helper places —
// the unresolved-reference ⚠, the resolution-caveat ⚠, and the resolved-advisory ▲. Each glyph takes a
// fixed-width slot and the next one is pushed past it, so a row carrying several never overlaps. Common
// rows are unchanged: a lone ⚠ stays at WARN_X0, a lone ▲ at ADVISORY_MIN_X (which clears the arc source
// that leaves a resolved row); only the colliding combinations move.

/** First ⚠ slot, measured from the label end (matches the historical single-glyph offset). */
const WARN_X0 = 12;
/** Advance to the next glyph slot — enough to clear one ⚠ (18px bold) or ▲ (15px) plus a small gap. */
const GLYPH_STEP = 18;
/** Extra width per digit of a ⚠'s "(+N)" count badge, so a following glyph clears the digits. */
const COUNT_STEP = 8;
/** The ▲ never sits closer than this: it clears the arc source (a resolved row is an arc source) and a
 *  lone ⚠. Matches the historical advisory offset, so a lone ▲ is unchanged. */
const ADVISORY_MIN_X = 30;

/** Which right-gutter glyphs a single row carries (collapsed from all diagnostics landing on it). */
export interface GutterOccupancy {
  /** An unresolved-reference ⚠ (broken/external). */
  refWarn: boolean;
  /** How many unresolved references collapsed onto the row — drives the "(+N)" badge width. */
  refCount: number;
  /** A resolution-caveat ⚠ (dialect / ignored siblings / invalid $id fragment). */
  caveat: boolean;
  /** A resolved-but-problematic advisory ▲. */
  advisory: boolean;
}

/** X offsets (from the label end) for each glyph a row may carry; each is meaningful only when present. */
export interface GutterSlots {
  refWarnX: number;
  caveatX: number;
  advisoryX: number;
}

/**
 * Pack a row's right-gutter glyphs into non-overlapping slots, left to right (refWarn ⚠ → caveat ⚠ →
 * advisory ▲), skipping any the row doesn't have and widening past a multi-digit "(+N)" count. Pure so it
 * is node-testable; the canvas adds each offset to the row's measured label end.
 */
export function gutterSlots(occ: GutterOccupancy): GutterSlots {
  const refWarnX = WARN_X0;
  let cursor = WARN_X0;
  if (occ.refWarn) {
    const digits = occ.refCount > 1 ? String(occ.refCount).length : 0;
    cursor += GLYPH_STEP + digits * COUNT_STEP;
  }
  const caveatX = cursor;
  if (occ.caveat) cursor += GLYPH_STEP;
  const advisoryX = Math.max(cursor, ADVISORY_MIN_X);
  return { refWarnX, caveatX, advisoryX };
}

/** Above this many rows a document's tree is windowed (only the rows near the viewport are mounted).
 *  Below it the whole tree renders, exactly as before — comfortably above any ordinary document. */
export const VIRTUALIZE_ABOVE = 2000;

/** Rows of slack rendered above and below the viewport, so a small scroll reveals already-mounted rows
 *  rather than blank space while the next window is painted. */
export const OVERSCAN_ROWS = 10;

/**
 * The half-open range of row indices `[start, end)` to mount for a tree of `total` rows whose viewport, in
 * the tree's own vertical coordinates, spans `[viewTop, viewBottom]`. Row `i`'s center sits at
 * `headerOffsetY + i*rowH`; `overscanRows` of slack is added on each side and the result is clamped to
 * `[0, total]`. A viewport entirely above or below the tree yields an empty (start === end) range.
 */
export function windowRange(
  total: number,
  viewTop: number,
  viewBottom: number,
  rowH: number,
  headerOffsetY: number,
  overscanRows: number,
): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  const firstVisible = Math.floor((viewTop - headerOffsetY) / rowH) - overscanRows;
  const lastVisible = Math.ceil((viewBottom - headerOffsetY) / rowH) + overscanRows;
  const start = Math.min(total, Math.max(0, firstVisible));
  const end = Math.max(start, Math.min(total, lastVisible + 1));
  return { start, end };
}
