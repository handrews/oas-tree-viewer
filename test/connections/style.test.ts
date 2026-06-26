import { describe, it, expect } from "vitest";
import {
  dashClass,
  connectionClasses,
  isDoubleLine,
  arrowheadMarkerId,
  connectionMarker,
} from "../../src/connections/style";

describe("dashClass", () => {
  it("maps each base dash token to its class (solid → none)", () => {
    expect(dashClass("solid")).toBeNull();
    expect(dashClass("dashed")).toBe("dashed");
    expect(dashClass("dotted")).toBe("dotted");
  });
});

describe("connectionClasses", () => {
  it("a plain resolved URI-reference is just the base edge + status", () => {
    expect(connectionClasses("uri-reference", { status: "resolved" })).toEqual([
      "ref-edge",
      "status-resolved",
    ]);
  });

  it("a dynamic reference carries the base dotted dash", () => {
    expect(connectionClasses("dynamic", { status: "resolved" })).toEqual([
      "ref-edge",
      "status-resolved",
      "dotted",
    ]);
  });

  it("layers status, advisory tint, collapsed, and focused in a stable order", () => {
    expect(
      connectionClasses("uri-reference", {
        status: "type-mismatch",
        advisory: "error",
        collapsed: true,
        focused: true,
      }),
    ).toEqual(["ref-edge", "status-type-mismatch", "diag-error", "collapsed", "focused"]);
  });

  it("a warning advisory tints diag-warning", () => {
    expect(
      connectionClasses("uri-reference", { status: "resolved", advisory: "warning" }),
    ).toContain("diag-warning");
  });

  it("omits the status class when there is no resolve status (a relationship)", () => {
    expect(connectionClasses("uri-reference", {})).toEqual(["ref-edge"]);
  });
});

describe("line / arrowhead / marker selectors", () => {
  it("isDoubleLine is true only for the implicit (double-line) kinds", () => {
    expect(isDoubleLine("component-name")).toBe(true);
    expect(isDoubleLine("operation-id")).toBe(true);
    expect(isDoubleLine("uri-reference")).toBe(false);
    expect(isDoubleLine("dynamic")).toBe(false);
  });

  it("arrowheadMarkerId picks the open marker for open arrowheads", () => {
    expect(arrowheadMarkerId("uri-reference")).toBe("ref-arrow");
    expect(arrowheadMarkerId("component-name")).toBe("ref-arrow-open");
    expect(arrowheadMarkerId("dynamic")).toBe("ref-arrow-open");
  });

  it("connectionMarker is the source-row glyph shape", () => {
    expect(connectionMarker("uri-reference")).toBe("asterisk");
    expect(connectionMarker("dynamic")).toBe("asterisk");
    expect(connectionMarker("component-name")).toBe("diamond");
    expect(connectionMarker("operation-id")).toBe("diamond");
  });
});
