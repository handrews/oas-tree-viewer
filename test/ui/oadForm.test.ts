import { describe, it, expect } from "vitest";
import {
  rebaseFolderUri,
  pickEntryIndex,
  folderNameOf,
  dirDocsFromFiles,
  dirLocalSource,
  urlFieldLabel,
  rowToInputs,
} from "../../src/ui/oadForm";
import type { FolderDoc, LocalSource } from "../../src/ui/oadForm";

const doc = (relativePath: string): FolderDoc => ({
  filename: relativePath.split("/").pop()!,
  relativePath,
  text: "",
});

const namedFile = (relativePath: string, text = "openapi: 3.1.0\n") => ({
  filename: relativePath.split("/").pop()!,
  relativePath,
  text,
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

describe("folderNameOf", () => {
  it("returns the first path segment", () => {
    expect(folderNameOf("myoad/schemas/pet.yaml")).toBe("myoad");
    expect(folderNameOf("single.yaml")).toBe("single.yaml");
  });
});

describe("dirDocsFromFiles", () => {
  it("keeps only JSON/YAML documents", () => {
    const docs = dirDocsFromFiles([
      namedFile("oad/openapi.yaml"),
      namedFile("oad/README.md"),
      namedFile("oad/schemas/pet.json"),
      namedFile("oad/.DS_Store"),
    ]);
    expect(docs.map((d) => d.relativePath)).toEqual(["oad/openapi.yaml", "oad/schemas/pet.json"]);
  });
});

describe("dirLocalSource", () => {
  it("filters to OAS docs, derives the folder name, and defaults the entry", () => {
    const src = dirLocalSource([
      namedFile("oad/schemas/pet.yaml"),
      namedFile("oad/README.md"),
      namedFile("oad/openapi.yaml"),
    ]);
    expect(src.kind).toBe("dir");
    expect(src.folderName).toBe("oad");
    expect(src.docs.map((d) => d.relativePath)).toEqual(["oad/schemas/pet.yaml", "oad/openapi.yaml"]);
    expect(src.entryIndex).toBe(1); // the conventional openapi.yaml
  });

  it("yields an empty bundle when no OAS documents are present", () => {
    const src = dirLocalSource([namedFile("oad/README.md")]);
    expect(src.docs).toHaveLength(0);
    expect(src.entryIndex).toBe(0);
  });
});

describe("urlFieldLabel", () => {
  it("adapts to the local source kind", () => {
    expect(urlFieldLabel("none")).toMatch(/URL to fetch/);
    expect(urlFieldLabel("file")).toMatch(/Retrieval URL/);
    expect(urlFieldLabel("dir")).toMatch(/Base URL/);
  });
});

describe("rowToInputs", () => {
  it("none + URL → a url input carrying isEntry", () => {
    expect(rowToInputs({ kind: "none" }, "https://x/e.yaml", true)).toEqual({
      inputs: [{ source: "url", url: "https://x/e.yaml", isEntry: true }],
    });
  });

  it("none + empty URL → a presence error", () => {
    const res = rowToInputs({ kind: "none" }, "  ", false);
    expect(res).toHaveProperty("error");
  });

  it("file → an upload, using a trimmed URL as the retrieval URI", () => {
    expect(rowToInputs({ kind: "file", filename: "e.yaml", text: "T" }, " https://x/e.yaml ", true)).toEqual({
      inputs: [
        { source: "upload", filename: "e.yaml", text: "T", retrievalUri: "https://x/e.yaml", isEntry: true },
      ],
    });
  });

  it("file with no URL → an upload with an undefined retrieval URI", () => {
    const res = rowToInputs({ kind: "file", filename: "e.yaml", text: "T" }, "", false);
    expect(res).toEqual({
      inputs: [{ source: "upload", filename: "e.yaml", text: "T", retrievalUri: undefined, isEntry: false }],
    });
  });

  it("dir → one upload per doc, entry first, isEntry only on the entry when the row is the entry", () => {
    const local: LocalSource = {
      kind: "dir",
      folderName: "oad",
      docs: [doc("oad/schemas/pet.yaml"), doc("oad/openapi.yaml")],
      entryIndex: 1,
    };
    const res = rowToInputs(local, "", true);
    expect("inputs" in res && res.inputs.map((i) => [i.source, (i as { relativePath?: string }).relativePath, i.isEntry])).toEqual([
      ["upload", "oad/openapi.yaml", true],
      ["upload", "oad/schemas/pet.yaml", false],
    ]);
  });

  it("dir with a base URL → rebases each document's retrieval URI", () => {
    const local: LocalSource = {
      kind: "dir",
      folderName: "oad",
      docs: [doc("oad/openapi.yaml"), doc("oad/schemas/pet.yaml")],
      entryIndex: 0,
    };
    const res = rowToInputs(local, "https://example.com/api/", true);
    if (!("inputs" in res)) throw new Error("expected inputs");
    expect(res.inputs.map((i) => (i as { retrievalUri?: string }).retrievalUri)).toEqual([
      "https://example.com/api/openapi.yaml",
      "https://example.com/api/schemas/pet.yaml",
    ]);
  });

  it("dir as a non-entry row → no document is marked entry", () => {
    const local: LocalSource = {
      kind: "dir",
      folderName: "oad",
      docs: [doc("oad/openapi.yaml"), doc("oad/schemas/pet.yaml")],
      entryIndex: 0,
    };
    const res = rowToInputs(local, "", false);
    if (!("inputs" in res)) throw new Error("expected inputs");
    expect(res.inputs.every((i) => i.isEntry === false)).toBe(true);
  });

  it("dir with no docs → a presence error", () => {
    const res = rowToInputs({ kind: "dir", folderName: "oad", docs: [], entryIndex: 0 }, "", true);
    expect(res).toHaveProperty("error");
  });
});
