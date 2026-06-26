import { describe, it, expect } from "vitest";
import { documentPositions } from "../../src/parse/positions";

describe("documentPositions", () => {
  const yaml = [
    "openapi: 3.1.0", // line 1
    "info:", // line 2
    "  title: T", // line 3
    "paths:", // line 4
    "  /pets:", // line 5
    "    get: {}", // line 6
    "list:", // line 7
    "  - a", // line 8
    "  - b", // line 9
    "",
  ].join("\n");

  it("maps each YAML pointer to its value's source range (pointers match TreeNode ids)", () => {
    const pos = documentPositions(yaml);
    expect(pos.get("")?.start.line).toBe(1); // root map
    // The scalar value "3.1.0" starts at column 10 on line 1.
    expect(pos.get("/openapi")?.start).toEqual({ line: 1, col: 10 });
    expect(pos.get("/info/title")?.start.line).toBe(3);
    // A pointer token containing "/" is escaped to ~1, exactly as buildTree does.
    expect(pos.get("/paths/~1pets/get")?.start.line).toBe(6);
    expect(pos.get("/list/0")?.start.line).toBe(8);
    expect(pos.get("/list/1")?.start.line).toBe(9);
    expect(pos.get("/nope")).toBeUndefined();
  });

  it("locates pointers in JSON the same way (YAML is a superset)", () => {
    const json = JSON.stringify({ a: { b: [1, 2] } }, null, 2);
    // { \n  "a": { \n    "b": [ \n      1, \n      2 \n ...
    const pos = documentPositions(json);
    expect(pos.get("/a")?.start.line).toBe(2);
    expect(pos.get("/a/b")?.start.line).toBe(3);
    expect(pos.get("/a/b/0")?.start.line).toBe(4);
    expect(pos.get("/a/b/1")?.start.line).toBe(5);
  });

  it("returns an empty map for empty input", () => {
    expect(documentPositions("").size).toBe(0);
  });

  it("records a range for an empty value and skips complex (non-scalar) keys", () => {
    const pos = documentPositions(["a:", "? [x, y]", ": 1"].join("\n"));
    expect(pos.has("")).toBe(true); // the root map still has a range
    expect(pos.has("/a")).toBe(true); // `a:` (null value) still has a source position
    // The complex `[x, y]` mapping key is skipped without error, contributing no pointer.
    expect([...pos.keys()].some((k) => k.includes("x"))).toBe(false);
  });
});
