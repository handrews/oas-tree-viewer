import { describe, it, expect } from "vitest";
import {
  categoryClass,
  categoryShape,
  categoryLabel,
  legendGroups,
  shapeLegend,
  referenceLegend,
  resolutionStyles,
  lineLegend,
  errorIconLegend,
  warningLegend,
} from "../../src/render/colors";
import type { NodeCategory, ResolutionKind } from "../../src/types";

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

  it("node-shape, line, error, and warning legends cover the documented entries", () => {
    expect(shapeLegend.map((s) => s.shape)).toEqual(["circle", "square"]);
    expect(lineLegend.map((l) => l.variant)).toEqual(["collapsed", "type-mismatch"]);
    expect(errorIconLegend.map((e) => e.status)).toEqual(["broken", "external"]);
    for (const row of [...shapeLegend, ...lineLegend, ...errorIconLegend]) {
      expect(row.label).toBeTruthy();
    }
    expect(warningLegend.unreachable).toBeTruthy();
  });

  it("resolutionStyles distinguish URI-reference (asterisk/single/filled) from component-name (diamond/double/open)", () => {
    expect(resolutionStyles["uri-reference"]).toMatchObject({
      marker: "asterisk",
      line: "single",
      arrowhead: "filled",
    });
    expect(resolutionStyles["component-name"]).toMatchObject({
      marker: "diamond",
      line: "double",
      arrowhead: "open",
    });
    const kinds: ResolutionKind[] = ["uri-reference", "component-name"];
    for (const k of kinds) expect(resolutionStyles[k].label).toBeTruthy();
  });

  it("referenceLegend lists every ResolutionKind in order with its style", () => {
    expect(referenceLegend.map((r) => r.kind)).toEqual(["uri-reference", "component-name"]);
    for (const r of referenceLegend) {
      expect(r).toMatchObject(resolutionStyles[r.kind]);
      expect(r.label).toBeTruthy();
    }
  });
});
