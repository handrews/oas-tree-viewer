import { describe, it, expect } from "vitest";
import {
  categoryClass,
  categoryShape,
  categoryLabel,
  legendGroups,
  shapeLegend,
  referenceLegend,
  lineLegend,
  errorIconLegend,
  warningLegend,
} from "../../src/render/colors";
import { connectionStyle } from "../../src/connections/catalog";
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

  it("node-shape, line, error, and warning legends cover the documented entries", () => {
    expect(shapeLegend.map((s) => s.shape)).toEqual(["circle", "square"]);
    expect(lineLegend.map((l) => l.variant)).toEqual(["collapsed", "type-mismatch"]);
    expect(errorIconLegend.map((e) => e.status)).toEqual(["broken", "external", "dialect"]);
    for (const row of [...shapeLegend, ...lineLegend, ...errorIconLegend]) {
      expect(row.label).toBeTruthy();
    }
    expect(warningLegend.unreachable).toBeTruthy();
  });

  it("referenceLegend folds operation-id into the implicit row and adds the dynamic row", () => {
    // operation-id shares the component-name visual, so the legend collapses it into the
    // implicit-connection row; the dynamic (dotted) $dynamicRef gets its own row.
    expect(referenceLegend.map((r) => r.kind)).toEqual([
      "uri-reference",
      "component-name",
      "dynamic",
    ]);
    // Each legend row's visual is sourced from the connection style catalog (so they can't drift).
    for (const r of referenceLegend) {
      const { marker, line, arrowhead } = connectionStyle(r.kind);
      expect(r).toMatchObject({ marker, line, arrowhead });
      expect(r.label).toBeTruthy();
    }
    // The folded row's label names operationId so the legend documents both meanings.
    const implicitRow = referenceLegend.find((r) => r.kind === "component-name")!;
    expect(implicitRow.label).toMatch(/operationId/i);
    // The dynamic row carries the dotted flag so the legend renders a dotted sample.
    expect(referenceLegend.find((r) => r.kind === "dynamic")!.dash).toBe("dotted");
  });
});
