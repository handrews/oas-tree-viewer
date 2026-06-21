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

  it("resolutionStyles distinguish URI-reference (asterisk/single/filled) from the implicit visual (diamond/double/open)", () => {
    expect(resolutionStyles["uri-reference"]).toMatchObject({
      marker: "asterisk",
      line: "single",
      arrowhead: "filled",
    });
    // component-name and operation-id are both implicit connections — same diamond/double/open
    // visual — distinguished only by which reference kind produced them.
    const implicit = { marker: "diamond", line: "double", arrowhead: "open" } as const;
    expect(resolutionStyles["component-name"]).toMatchObject(implicit);
    expect(resolutionStyles["operation-id"]).toMatchObject(implicit);
    // A dynamic $dynamicRef reuses the URI-reference asterisk but is dotted (tentative).
    expect(resolutionStyles["dynamic"]).toMatchObject({
      marker: "asterisk",
      line: "single",
      arrowhead: "open",
      dash: "dotted",
    });
    const kinds: ResolutionKind[] = ["uri-reference", "component-name", "operation-id", "dynamic"];
    for (const k of kinds) expect(resolutionStyles[k].label).toBeTruthy();
  });

  it("referenceLegend folds operation-id into the implicit row and adds the dynamic row", () => {
    // operation-id shares the component-name visual, so the legend collapses it into the
    // implicit-connection row; the dynamic (dotted) $dynamicRef gets its own row.
    expect(referenceLegend.map((r) => r.kind)).toEqual([
      "uri-reference",
      "component-name",
      "dynamic",
    ]);
    for (const r of referenceLegend) {
      const { marker, line, arrowhead } = resolutionStyles[r.kind];
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
