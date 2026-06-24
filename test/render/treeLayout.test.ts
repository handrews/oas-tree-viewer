import { describe, expect, test } from "vitest";
import {
  COUNT_DX,
  SECONDARY_DX,
  SECONDARY_MAX,
  estimateLabelWidth,
} from "../../src/render/treeLayout";

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
