import { describe, it, expect } from "vitest";
import {
  decodeFragment,
  isAbsoluteUri,
  normalizeUri,
  resolveUri,
  splitFragment,
} from "../../src/refs/baseUri";

describe("isAbsoluteUri", () => {
  it("recognizes anything with a scheme", () => {
    expect(isAbsoluteUri("https://x/y")).toBe(true);
    expect(isAbsoluteUri("urn:oad:1")).toBe(true);
    expect(isAbsoluteUri("file:///a")).toBe(true);
  });
  it("rejects relative references", () => {
    expect(isAbsoluteUri("/abs/path")).toBe(false);
    expect(isAbsoluteUri("rel.yaml")).toBe(false);
    expect(isAbsoluteUri("#frag")).toBe(false);
  });
});

describe("splitFragment", () => {
  it("splits at the first #", () => {
    expect(splitFragment("a.yaml#/x/y")).toEqual({ uriPart: "a.yaml", fragment: "/x/y" });
    expect(splitFragment("#/x")).toEqual({ uriPart: "", fragment: "/x" });
    expect(splitFragment("a.yaml")).toEqual({ uriPart: "a.yaml", fragment: null });
    expect(splitFragment("a#")).toEqual({ uriPart: "a", fragment: "" });
  });
});

describe("normalizeUri", () => {
  it("normalizes scheme case, default port, and dot-segments", () => {
    expect(normalizeUri("HTTPS://Example.com:443/a/../b")).toBe("https://example.com/b");
  });
  it("leaves non-URLs unchanged", () => {
    expect(normalizeUri("not a uri")).toBe("not a uri");
  });
});

describe("resolveUri", () => {
  it("normalizes an absolute reference regardless of base", () => {
    expect(resolveUri("https://e.com/a", undefined)).toBe("https://e.com/a");
  });
  it("resolves a relative reference against an http base", () => {
    expect(resolveUri("shared.yaml", "https://e.com/oad/entry.yaml")).toBe(
      "https://e.com/oad/shared.yaml",
    );
  });
  it("treats an empty uriPart as the base", () => {
    expect(resolveUri("", "https://e.com/a")).toBe("https://e.com/a");
    expect(resolveUri("", undefined)).toBeNull();
  });
  it("returns null when a relative ref has no usable base", () => {
    expect(resolveUri("shared.yaml", "urn:oad:1")).toBeNull();
    expect(resolveUri("shared.yaml", undefined)).toBeNull();
  });
});

describe("decodeFragment", () => {
  it("percent-decodes", () => {
    expect(decodeFragment("/paths/%7Bid%7D")).toBe("/paths/{id}");
  });
  it("returns malformed input unchanged", () => {
    expect(decodeFragment("%")).toBe("%");
  });
});
