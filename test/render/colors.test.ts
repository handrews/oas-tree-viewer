import { describe, it, expect } from "vitest";
import { categoryClass, categoryShape, categoryLabel, legendOrder } from "../../src/render/colors";
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
  it("has a label for every category", () => {
    for (const c of ALL) expect(categoryLabel[c]).toBeTruthy();
  });

  it("categoryClass maps a category to its cat- class, defaulting to object", () => {
    for (const c of ALL) expect(categoryClass(c)).toBe(`cat-${c}`);
    expect(categoryClass(undefined)).toBe("cat-object");
  });

  it("legendOrder references only known categories", () => {
    for (const c of legendOrder) expect(categoryLabel[c]).toBeTruthy();
  });

  it("categoryShape is square for object/array/scalar and circle otherwise", () => {
    expect(categoryShape("object")).toBe("square");
    expect(categoryShape("array")).toBe("square");
    expect(categoryShape("scalar")).toBe("square");
    for (const c of ALL.filter((c) => !["object", "array", "scalar"].includes(c))) {
      expect(categoryShape(c)).toBe("circle");
    }
    expect(categoryShape(undefined)).toBe("circle");
  });
});
