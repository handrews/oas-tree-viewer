import { describe, it, expect } from "vitest";
import { connectionCatalog, connectionStyle } from "../../src/connections/catalog";
import {
  CONNECTION_KINDS,
  CONNECTION_FAMILIES,
  LINE_STYLES,
  DASH_STYLES,
  ARROWHEAD_STYLES,
  CONNECTION_MARKERS,
} from "../../src/connections/types";

describe("connection catalog", () => {
  const catalog = connectionCatalog();

  it("covers exactly CONNECTION_KINDS", () => {
    expect(Object.keys(catalog).sort()).toEqual([...CONNECTION_KINDS].sort());
  });

  it("uses only in-vocabulary tokens for every kind, with a non-empty label", () => {
    for (const kind of CONNECTION_KINDS) {
      const s = catalog[kind];
      expect(CONNECTION_FAMILIES).toContain(s.family);
      expect(LINE_STYLES).toContain(s.line);
      expect(DASH_STYLES).toContain(s.dash);
      expect(ARROWHEAD_STYLES).toContain(s.arrowhead);
      expect(CONNECTION_MARKERS).toContain(s.marker);
      expect(s.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("preserves today's visuals (the byte-faithful seed from resolutionStyles)", () => {
    expect(connectionStyle("uri-reference")).toMatchObject({
      family: "reference",
      line: "single",
      dash: "solid",
      arrowhead: "filled",
      marker: "asterisk",
    });
    // component-name and operation-id share one visual today (the implicit-connection look).
    expect(connectionStyle("component-name")).toMatchObject({
      line: "double",
      dash: "solid",
      arrowhead: "open",
      marker: "diamond",
    });
    expect(connectionStyle("operation-id")).toMatchObject({
      line: "double",
      dash: "solid",
      arrowhead: "open",
      marker: "diamond",
    });
    expect(connectionStyle("dynamic")).toMatchObject({
      line: "single",
      dash: "dotted",
      arrowhead: "open",
      marker: "asterisk",
    });
  });
});
