import { describe, it, expect, vi, afterEach } from "vitest";
import { loadDocument, versionFamilyOf } from "../src/loader";
import { NotOpenApiError, RetrievalError, UnsupportedVersionError } from "../src/errors";

const valid = (extra = "") =>
  `openapi: 3.1.0\ninfo: { title: T, version: '1' }\npaths: {}\n${extra}`;

describe("versionFamilyOf", () => {
  it("maps versions to families", () => {
    expect(versionFamilyOf("3.1.0")).toBe("3.1");
    expect(versionFamilyOf("3.2.5")).toBe("3.2");
  });
});

describe("loadDocument (upload)", () => {
  it("loads, validates, and classifies a valid document", async () => {
    const doc = await loadDocument({
      source: "upload",
      filename: "d.yaml",
      text: valid("$self: https://e/x"),
      isEntry: true,
    });
    expect(doc.oasVersion).toBe("3.1.0");
    expect(doc.format).toBe("yaml");
    expect(doc.selfUri).toBe("https://e/x");
    expect(doc.root.oasType).toBe("OpenAPI Object");
  });

  it("rejects a document with no openapi field", async () => {
    await expect(
      loadDocument({ source: "upload", filename: "d.json", text: '{"a":1}', isEntry: true }),
    ).rejects.toBeInstanceOf(NotOpenApiError);
  });

  it("rejects an unsupported version", async () => {
    await expect(
      loadDocument({ source: "upload", filename: "d.yaml", text: "openapi: 3.0.3\ninfo: {}\n", isEntry: true }),
    ).rejects.toBeInstanceOf(UnsupportedVersionError);
  });

  it("rejects a non-object root", async () => {
    await expect(
      loadDocument({ source: "upload", filename: "d.json", text: "[1,2]", isEntry: true }),
    ).rejects.toBeInstanceOf(NotOpenApiError);
  });

  it("keeps the optional retrieval URI", async () => {
    const doc = await loadDocument({
      source: "upload",
      filename: "d.yaml",
      text: valid(),
      retrievalUri: "https://host/api.yaml",
      isEntry: true,
    });
    expect(doc.retrievalUri).toBe("https://host/api.yaml");
  });

  it("derives a file:// retrieval URI from the file name when none is given", async () => {
    const doc = await loadDocument({
      source: "upload",
      filename: "entry.yaml",
      text: valid(),
      isEntry: true,
    });
    expect(doc.retrievalUri).toBe("file:///entry.yaml");
  });
});

describe("loadDocument (url)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches and parses, recording the URL as the retrieval URI", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(valid(), { status: 200 })));
    const doc = await loadDocument({ source: "url", url: "https://e.com/api.yaml", isEntry: true });
    expect(doc.retrievalUri).toBe("https://e.com/api.yaml");
    expect(doc.oasVersion).toBe("3.1.0");
  });

  it("throws RetrievalError on an HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" })),
    );
    await expect(
      loadDocument({ source: "url", url: "https://e.com/x", isEntry: true }),
    ).rejects.toBeInstanceOf(RetrievalError);
  });

  it("throws RetrievalError when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(
      loadDocument({ source: "url", url: "https://e.com/x", isEntry: true }),
    ).rejects.toBeInstanceOf(RetrievalError);
  });
});
