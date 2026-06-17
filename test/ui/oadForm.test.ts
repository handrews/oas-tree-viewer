import { describe, it, expect } from "vitest";
import { rebaseFolderUri, pickEntryIndex } from "../../src/ui/oadForm";
import type { FolderDoc } from "../../src/ui/oadForm";

const doc = (relativePath: string): FolderDoc => ({
  filename: relativePath.split("/").pop()!,
  relativePath,
  text: "",
});

describe("rebaseFolderUri", () => {
  it("strips the folder name and maps onto the base URL", () => {
    expect(rebaseFolderUri("myoad/schemas/pet.yaml", "https://example.com/api/")).toBe(
      "https://example.com/api/schemas/pet.yaml",
    );
  });

  it("adds a trailing slash to the base when missing", () => {
    expect(rebaseFolderUri("oad/openapi.yaml", "https://x.com/api")).toBe(
      "https://x.com/api/openapi.yaml",
    );
  });

  it("returns undefined for an unusable base URL", () => {
    expect(rebaseFolderUri("oad/a.yaml", "not a url")).toBeUndefined();
  });
});

describe("pickEntryIndex", () => {
  it("prefers a conventionally-named openapi file", () => {
    expect(
      pickEntryIndex([doc("oad/schemas/pet.yaml"), doc("oad/openapi.yaml"), doc("oad/schemas/error.yaml")]),
    ).toBe(1);
  });

  it("otherwise picks the shallowest path", () => {
    expect(pickEntryIndex([doc("a/b/c/deep.yaml"), doc("a/top.yaml")])).toBe(1);
  });
});
