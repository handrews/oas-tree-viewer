import { describe, it, expect } from "vitest";
import { buildTree, descendantCount, kindOf } from "../../src/model/treeBuilder";

describe("kindOf", () => {
  it("classifies JSON value kinds", () => {
    expect(kindOf(null)).toBe("null");
    expect(kindOf([1])).toBe("array");
    expect(kindOf({})).toBe("object");
    expect(kindOf("s")).toBe("string");
    expect(kindOf(3)).toBe("number");
    expect(kindOf(true)).toBe("boolean");
  });
});

describe("buildTree", () => {
  const root = buildTree({ a: 1, "b/c": [true, null], d: { e: "x" } });

  it("makes the root with an empty pointer and root keyKind", () => {
    expect(root.id).toBe("");
    expect(root.keyKind).toBe("root");
    expect(root.valueKind).toBe("object");
  });

  it("escapes pointer tokens and records keyKind", () => {
    const bc = root.children.find((c) => c.key === "b/c")!;
    expect(bc.id).toBe("/b~1c");
    expect(bc.keyKind).toBe("property");
    expect(bc.valueKind).toBe("array");
    expect(bc.children.map((c) => c.id)).toEqual(["/b~1c/0", "/b~1c/1"]);
    expect(bc.children[0]!.keyKind).toBe("index");
  });

  it("stores scalar values on leaves", () => {
    const a = root.children.find((c) => c.key === "a")!;
    expect(a.scalarValue).toBe(1);
    expect(a.children).toHaveLength(0);
  });

  it("counts descendants", () => {
    // a, b/c, d (3) + b/c's 2 items + d.e (1) = 6
    expect(descendantCount(root)).toBe(6);
  });
});
