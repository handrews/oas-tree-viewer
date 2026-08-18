import { describe, it, expect } from "vitest";
import { inlineDocsFromOad } from "../../src/mcp/fromOad";
import type { Oad, OadDocument, TreeNode } from "../../src/types";

const ROOT: TreeNode = { id: "", key: null, keyKind: "root", valueKind: "object", children: [] };

function doc(overrides: Partial<OadDocument>): OadDocument {
  return {
    id: "doc-1",
    isEntry: false,
    source: "upload",
    format: "yaml",
    raw: "openapi: 3.1.0\n",
    value: {},
    kind: "openapi",
    root: ROOT,
    ...overrides,
  };
}

describe("inlineDocsFromOad", () => {
  it("maps each OadDocument to an InlineDoc, carrying filename/text/retrievalUri/isEntry", () => {
    const oad: Oad = {
      versionFamily: "3.1",
      documents: [
        doc({
          id: "doc-7",
          isEntry: true,
          filename: "openapi.yaml",
          retrievalUri: "https://example.com/openapi.yaml",
          raw: "openapi: 3.1.0\ninfo: { title: T, version: '1' }\n",
        }),
        doc({ id: "doc-8", isEntry: false, filename: "shared.yaml", raw: "components: {}\n" }),
      ],
    };

    expect(inlineDocsFromOad(oad)).toEqual([
      {
        filename: "openapi.yaml",
        text: "openapi: 3.1.0\ninfo: { title: T, version: '1' }\n",
        retrievalUri: "https://example.com/openapi.yaml",
        isEntry: true,
      },
      {
        filename: "shared.yaml",
        text: "components: {}\n",
        retrievalUri: undefined,
        isEntry: false,
      },
    ]);
  });

  it("never lets a docId leak into the filename (falls back to retrievalUri, then a synthetic label)", () => {
    const oad: Oad = {
      versionFamily: "3.1",
      documents: [
        doc({ id: "doc-3", filename: undefined, retrievalUri: "https://example.com/a.yaml" }),
        doc({ id: "doc-4", filename: undefined, retrievalUri: undefined }),
      ],
    };

    const docs = inlineDocsFromOad(oad);
    expect(docs[0]!.filename).toBe("https://example.com/a.yaml");
    expect(docs[1]!.filename).toBe("document-2");
    for (const d of docs) {
      expect(d.filename).not.toMatch(/^doc-\d+$/);
    }
  });
});
