import { describe, expect, test } from "vitest";
import {
  COUNT_DX,
  SECONDARY_DX,
  SECONDARY_MAX,
  estimateLabelWidth,
  gutterSlots,
  windowRange,
} from "../../src/render/treeLayout";
import type { GutterOccupancy } from "../../src/render/treeLayout";

describe("estimateLabelWidth", () => {
  test("an empty label has zero width", () => {
    expect(estimateLabelWidth("", "", 0)).toBe(0);
  });

  test("returns an integer (rounded up)", () => {
    const w = estimateLabelWidth("operationId", "", 0);
    expect(Number.isInteger(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });

  test("grows monotonically with the primary length", () => {
    const a = estimateLabelWidth("a", "", 0);
    const ab = estimateLabelWidth("ab", "", 0);
    const abc = estimateLabelWidth("abc", "", 0);
    expect(ab).toBeGreaterThan(a);
    expect(abc).toBeGreaterThan(ab);
  });

  test("a hidden-child count adds the gap plus the rendered '(+N)'", () => {
    const base = estimateLabelWidth("schemas", "", 0);
    const withCount = estimateLabelWidth("schemas", "", 12);
    expect(withCount).toBeGreaterThan(base + COUNT_DX);
  });

  test("a secondary label adds its gap plus its width", () => {
    const base = estimateLabelWidth("type", "", 0);
    const withSecondary = estimateLabelWidth("type", ": object", 0);
    expect(withSecondary).toBeGreaterThan(base + SECONDARY_DX);
  });

  test("the secondary contribution is capped at SECONDARY_MAX characters", () => {
    const atCap = estimateLabelWidth("k", "x".repeat(SECONDARY_MAX), 0);
    const overCap = estimateLabelWidth("k", "x".repeat(SECONDARY_MAX + 40), 0);
    // Beyond the cap the label is truncated, so the estimate stops growing.
    expect(overCap).toBe(atCap);
  });

  test("over-estimates a plausibly-wide key (markers must clear the text)", () => {
    // A 20-char key at 12px proportional text is well under ~160px in any real font; the estimate sits
    // above that so a right-gutter marker placed just past the label never lands on top of it.
    expect(estimateLabelWidth("x".repeat(20), "", 0)).toBeGreaterThan(120);
  });
});

describe("gutterSlots", () => {
  const occ = (p: Partial<GutterOccupancy>): GutterOccupancy => ({
    refWarn: false,
    refCount: 0,
    caveat: false,
    advisory: false,
    ...p,
  });

  // A glyph is ~16px wide at its font size; require at least that between any two occupied slots.
  const MIN_GAP = 16;
  const presentXs = (o: GutterOccupancy, s: ReturnType<typeof gutterSlots>): number[] => {
    const xs: number[] = [];
    if (o.refWarn) xs.push(s.refWarnX);
    if (o.caveat) xs.push(s.caveatX);
    if (o.advisory) xs.push(s.advisoryX);
    return xs;
  };

  test("a lone ⚠ keeps the historical first-slot offset", () => {
    expect(gutterSlots(occ({ refWarn: true, refCount: 1 })).refWarnX).toBe(12);
    expect(gutterSlots(occ({ caveat: true })).caveatX).toBe(12);
  });

  test("a lone ▲ keeps the historical advisory offset (clears the arc source)", () => {
    expect(gutterSlots(occ({ advisory: true })).advisoryX).toBe(30);
  });

  test("the advisory ▲ never sits closer than its minimum, whatever else is present", () => {
    for (const o of [
      occ({ advisory: true }),
      occ({ refWarn: true, refCount: 1, advisory: true }),
      occ({ caveat: true, advisory: true }),
    ]) {
      expect(gutterSlots(o).advisoryX).toBeGreaterThanOrEqual(30);
    }
  });

  test("a refWarn ⚠ and a caveat ⚠ on one row don't collide", () => {
    const s = gutterSlots(occ({ refWarn: true, refCount: 1, caveat: true }));
    expect(s.caveatX - s.refWarnX).toBeGreaterThanOrEqual(MIN_GAP);
  });

  test("a multi-digit (+N) count pushes a following ▲ further right", () => {
    const single = gutterSlots(occ({ refWarn: true, refCount: 1, advisory: true })).advisoryX;
    const many = gutterSlots(occ({ refWarn: true, refCount: 20, advisory: true })).advisoryX;
    expect(many).toBeGreaterThan(single);
  });

  test("a count of 1 shows no badge, so it doesn't widen the next slot", () => {
    const one = gutterSlots(occ({ refWarn: true, refCount: 1, advisory: true })).advisoryX;
    const two = gutterSlots(occ({ refWarn: true, refCount: 2, advisory: true })).advisoryX;
    expect(two).toBeGreaterThan(one);
  });

  test("all three glyphs pack left-to-right without overlap", () => {
    const o = occ({ refWarn: true, refCount: 3, caveat: true, advisory: true });
    const s = gutterSlots(o);
    expect(s.refWarnX).toBeLessThan(s.caveatX);
    expect(s.caveatX).toBeLessThan(s.advisoryX);
    const xs = presentXs(o, s);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(MIN_GAP);
    }
  });

  test("offsets are integers", () => {
    const s = gutterSlots(occ({ refWarn: true, refCount: 15, caveat: true, advisory: true }));
    expect(Number.isInteger(s.refWarnX)).toBe(true);
    expect(Number.isInteger(s.caveatX)).toBe(true);
    expect(Number.isInteger(s.advisoryX)).toBe(true);
  });
});

describe("windowRange", () => {
  // headerOffsetY 0 + rowH 10 makes the index math read directly: row i centers at y = 10*i.
  test("an empty tree yields an empty range", () => {
    expect(windowRange(0, 0, 100, 10, 0, 0)).toEqual({ start: 0, end: 0 });
  });

  test("a viewport over the middle selects that band (+1 exclusive end)", () => {
    expect(windowRange(100, 200, 300, 10, 0, 0)).toEqual({ start: 20, end: 31 });
  });

  test("overscan widens the band on both sides", () => {
    expect(windowRange(100, 200, 300, 10, 0, 5)).toEqual({ start: 15, end: 36 });
  });

  test("clamps to the top of the tree", () => {
    expect(windowRange(100, 0, 50, 10, 0, 5)).toEqual({ start: 0, end: 11 });
  });

  test("clamps to the bottom of the tree", () => {
    const { end } = windowRange(100, 900, 1100, 10, 0, 5);
    expect(end).toBe(100);
  });

  test("a viewport entirely above the tree is empty", () => {
    expect(windowRange(100, -500, -400, 10, 0, 0)).toEqual({ start: 0, end: 0 });
  });

  test("a viewport entirely below the tree is empty", () => {
    const { start, end } = windowRange(100, 5000, 6000, 10, 0, 0);
    expect(start).toBe(end);
  });

  test("honors a non-zero header offset", () => {
    // With the first row pushed down by 100px, a [100,200] viewport starts at row 0.
    expect(windowRange(100, 100, 200, 10, 100, 0)).toEqual({ start: 0, end: 11 });
  });
});
