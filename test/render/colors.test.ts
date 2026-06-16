import { describe, it, expect } from "vitest";
import { categoryColor, categoryLabel, colorFor, legendOrder } from "../../src/render/colors";
import type { NodeCategory } from "../../src/types";

const ALL: NodeCategory[] = [
  "root",
  "structure",
  "operation",
  "schema",
  "io",
  "meta",
  "security",
  "reference",
  "object",
  "array",
  "scalar",
];

describe("colors", () => {
  it("has a hex color and a label for every category", () => {
    for (const c of ALL) {
      expect(categoryColor[c]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(categoryLabel[c]).toBeTruthy();
    }
  });

  it("colorFor falls back to object for an undefined category", () => {
    expect(colorFor(undefined)).toBe(categoryColor.object);
    expect(colorFor("schema")).toBe(categoryColor.schema);
  });

  it("legendOrder references only known categories", () => {
    for (const c of legendOrder) expect(categoryColor[c]).toBeDefined();
  });
});
