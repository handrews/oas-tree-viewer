import { describe, it, expect } from "vitest";
import {
  categoryClass,
  categoryShape,
  categoryLabel,
  legendGroups,
  shapeLegend,
  lineLegend,
  errorIconLegend,
  warningLegend,
} from "../../src/render/colors";
import type { NodeCategory } from "../../src/types";

const ALL: NodeCategory[] = [
  "structural",
  "metadata",
  "http",
  "data",
  "security",
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

  it("legendGroups are the five semantic groups, all with labels", () => {
    expect(legendGroups).toEqual(["structural", "metadata", "http", "data", "security"]);
    for (const c of legendGroups) expect(categoryLabel[c]).toBeTruthy();
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

  it("legend data tables cover the documented shapes/styles/statuses", () => {
    expect(shapeLegend.map((s) => s.shape)).toEqual(["circle", "square", "asterisk"]);
    expect(lineLegend.map((l) => l.style)).toEqual(["solid", "dashed"]);
    expect(errorIconLegend.map((e) => e.status)).toEqual(["broken", "external"]);
    for (const row of [...shapeLegend, ...lineLegend, ...errorIconLegend]) {
      expect(row.label).toBeTruthy();
    }
    expect(warningLegend.unreachable).toBeTruthy();
  });
});
