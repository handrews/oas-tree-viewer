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
