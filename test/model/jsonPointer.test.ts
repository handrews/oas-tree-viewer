import { describe, it, expect } from "vitest";
import {
  appendPointer,
  displayPointer,
  escapeToken,
  unescapeToken,
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
});
