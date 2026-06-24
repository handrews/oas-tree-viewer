import { describe, it, expect } from "vitest";
import {
  appendPointer,
  displayPointer,
  escapeToken,
  unescapeToken,
  valueAtPointer,
} from "../../src/model/jsonPointer";

describe("jsonPointer", () => {
  it("escapes ~ then / per RFC 6901", () => {
    expect(escapeToken("a/b~c")).toBe("a~1b~0c");
  });

  it("round-trips with unescapeToken", () => {
    expect(unescapeToken("a~1b~0c")).toBe("a/b~c");
    expect(unescapeToken(escapeToken("~/~"))).toBe("~/~");
  });

  it("appends escaped tokens to a parent pointer", () => {
    expect(appendPointer("", "paths")).toBe("/paths");
    expect(appendPointer("/paths", "/pets")).toBe("/paths/~1pets");
    expect(appendPointer("/x", "0")).toBe("/x/0");
  });

  it("displays the root pointer as #", () => {
    expect(displayPointer("")).toBe("#");
    expect(displayPointer("/a/b")).toBe("#/a/b");
  });

  it("reads the value at a pointer, into objects and arrays", () => {
    const v = { a: { b: 2 }, list: [10, 20] };
    expect(valueAtPointer(v, "")).toBe(v); // root is the whole value
    expect(valueAtPointer(v, "/a/b")).toBe(2);
    expect(valueAtPointer(v, "/list/1")).toBe(20);
  });

  it("returns undefined when the path descends into a scalar or a missing key", () => {
    expect(valueAtPointer({ a: 1 }, "/a/b")).toBeUndefined(); // can't descend into the number 1
    expect(valueAtPointer({ a: {} }, "/a/missing")).toBeUndefined();
  });
});
