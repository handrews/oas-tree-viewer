import { describe, it, expect } from "vitest";
import { parseDocument } from "../../src/parse/detectFormat";
import { ParseError } from "../../src/errors";

describe("parseDocument", () => {
  it("parses JSON and labels it json", () => {
    expect(parseDocument('{"a":1}', "x.json")).toEqual({ value: { a: 1 }, format: "json" });
  });

  it("parses YAML and labels it yaml", () => {
    expect(parseDocument("a: 1\n", "x.yaml")).toEqual({ value: { a: 1 }, format: "yaml" });
  });

  it("honors a .json extension hint (invalid JSON throws)", () => {
    expect(() => parseDocument("a: 1", "x.json")).toThrow(ParseError);
  });

  it("auto-detects JSON first when no extension", () => {
    expect(parseDocument('{"a":1}').format).toBe("json");
  });

  it("auto-detects when the filename has no extension", () => {
    // A dot-less filename gives no extension hint, so detection falls back to content sniffing.
    expect(parseDocument('{"a":1}', "noext").format).toBe("json");
  });

  it("falls back to YAML when not JSON", () => {
    expect(parseDocument("a: 1").format).toBe("yaml");
  });

  it("throws ParseError on invalid YAML", () => {
    expect(() => parseDocument("a: '\n", "x.yaml")).toThrow(ParseError);
  });

  it("throws ParseError when neither JSON nor YAML", () => {
    expect(() => parseDocument("{ unterminated")).toThrow(ParseError);
  });
});
