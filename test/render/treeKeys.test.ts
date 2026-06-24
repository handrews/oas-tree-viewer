import { describe, expect, test } from "vitest";
import { treeKeyAction, type TreeKeyContext } from "../../src/render/treeKeys";

// The pure WAI-ARIA Tree View keyboard model. treeView.ts only carries out the action this returns, so
// these cases pin the whole navigation contract (the d3/SVG side stays browser/e2e-verified).

/** A context with sane defaults (focused on "b" in [a, b, c], a leaf), overridable per case. */
function ctx(over: {
  key: string;
  visibleIds?: readonly string[];
  focusedId?: string;
  node?: Partial<TreeKeyContext["node"]>;
}): TreeKeyContext {
  return {
    key: over.key,
    visibleIds: over.visibleIds ?? ["a", "b", "c"],
    focusedId: over.focusedId ?? "b",
    node: { collapsed: false, expanded: false, firstChildId: null, parentId: null, ...over.node },
  };
}

describe("vertical movement", () => {
  test("ArrowDown focuses the next visible row", () => {
    expect(treeKeyAction(ctx({ key: "ArrowDown" }))).toEqual({ type: "focus", id: "c" });
  });
  test("ArrowDown on the last row is handled but does nothing", () => {
    expect(treeKeyAction(ctx({ key: "ArrowDown", focusedId: "c" }))).toEqual({ type: "none" });
  });
  test("ArrowUp focuses the previous visible row", () => {
    expect(treeKeyAction(ctx({ key: "ArrowUp" }))).toEqual({ type: "focus", id: "a" });
  });
  test("ArrowUp on the first row is handled but does nothing", () => {
    expect(treeKeyAction(ctx({ key: "ArrowUp", focusedId: "a" }))).toEqual({ type: "none" });
  });
  test("Home focuses the first row, End the last", () => {
    expect(treeKeyAction(ctx({ key: "Home" }))).toEqual({ type: "focus", id: "a" });
    expect(treeKeyAction(ctx({ key: "End" }))).toEqual({ type: "focus", id: "c" });
  });
});

describe("ArrowRight (expand / step in)", () => {
  test("expands a collapsed branch, keeping focus on it", () => {
    expect(treeKeyAction(ctx({ key: "ArrowRight", node: { collapsed: true } }))).toEqual({
      type: "toggle",
      id: "b",
    });
  });
  test("steps into the first child of an already-expanded branch", () => {
    expect(
      treeKeyAction(ctx({ key: "ArrowRight", node: { expanded: true, firstChildId: "b1" } })),
    ).toEqual({ type: "focus", id: "b1" });
  });
  test("does nothing on a leaf", () => {
    expect(treeKeyAction(ctx({ key: "ArrowRight" }))).toEqual({ type: "none" });
  });
  test("does nothing on an expanded branch with no first child (defensive)", () => {
    expect(treeKeyAction(ctx({ key: "ArrowRight", node: { expanded: true } }))).toEqual({
      type: "none",
    });
  });
});

describe("ArrowLeft (collapse / step out)", () => {
  test("collapses an expanded branch, keeping focus on it", () => {
    expect(treeKeyAction(ctx({ key: "ArrowLeft", node: { expanded: true } }))).toEqual({
      type: "toggle",
      id: "b",
    });
  });
  test("steps out to the parent from a leaf", () => {
    expect(treeKeyAction(ctx({ key: "ArrowLeft", node: { parentId: "a" } }))).toEqual({
      type: "focus",
      id: "a",
    });
  });
  test("does nothing at a root-level leaf (no parent)", () => {
    expect(treeKeyAction(ctx({ key: "ArrowLeft" }))).toEqual({ type: "none" });
  });
});

describe("selection and unhandled keys", () => {
  test("Enter selects the focused node", () => {
    expect(treeKeyAction(ctx({ key: "Enter" }))).toEqual({ type: "select", id: "b" });
  });
  test("Space selects the focused node", () => {
    expect(treeKeyAction(ctx({ key: " " }))).toEqual({ type: "select", id: "b" });
  });
  test("an unhandled key returns null so the caller leaves the event alone", () => {
    expect(treeKeyAction(ctx({ key: "Tab" }))).toBeNull();
    expect(treeKeyAction(ctx({ key: "x" }))).toBeNull();
  });
});
