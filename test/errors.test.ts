import { describe, it, expect } from "vitest";
import {
  NotOpenApiError,
  OadError,
  ParseError,
  RetrievalError,
  UnsupportedVersionError,
  VersionMismatchError,
  errorMessage,
} from "../src/errors";

describe("error classes", () => {
  it("carry their own name and extend OadError", () => {
    const e = new ParseError("bad");
    expect(e).toBeInstanceOf(OadError);
    expect(e).toBeInstanceOf(ParseError);
    expect(e.name).toBe("ParseError");
    expect(e.message).toBe("bad");
  });

  it("are distinguishable", () => {
    expect(new NotOpenApiError("x").name).toBe("NotOpenApiError");
    expect(new UnsupportedVersionError("x").name).toBe("UnsupportedVersionError");
    expect(new RetrievalError("x").name).toBe("RetrievalError");
    expect(new VersionMismatchError("x").name).toBe("VersionMismatchError");
  });
});

describe("errorMessage", () => {
  it("extracts a message from anything", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});
