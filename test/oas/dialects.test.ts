import { describe, it, expect } from "vitest";
import {
  DRAFT_04,
  DRAFT_06,
  DRAFT_07,
  DRAFT_2020_12,
  annotateDialectSupport,
  idKeyword,
  isOasDialect,
  isResolutionSupported,
  normalizeDialect,
  oasDialectUri,
  referenceModel,
} from "../../src/oas/dialects";
import { buildTree } from "../../src/model/treeBuilder";
import { classifyDocument } from "../../src/oas/classify";
import type { TreeNode } from "../../src/types";

const DRAFT_07_HASH = "http://json-schema.org/draft-07/schema#";
const DRAFT_04_HASH = "http://json-schema.org/draft-04/schema#";
const DRAFT_2019_09 = "https://json-schema.org/draft/2019-09/schema";

describe("dialect recognition", () => {
  it("identifies OAS dialect URIs per version (base alias and dated)", () => {
    expect(isOasDialect("https://spec.openapis.org/oas/3.1/dialect/base", "3.1")).toBe(true);
    expect(isOasDialect("https://spec.openapis.org/oas/3.1/dialect/2024-11-10", "3.1")).toBe(true);
    expect(isOasDialect("https://spec.openapis.org/oas/3.2/dialect", "3.2")).toBe(true);
    expect(isOasDialect("https://spec.openapis.org/oas/3.1/dialect/base", "3.2")).toBe(false);
  });

  it("maps a version to its registered OAS dialect URI", () => {
    expect(oasDialectUri("3.1")).toBe("https://spec.openapis.org/oas/3.1/dialect/base");
    expect(oasDialectUri("3.2")).toBe("https://spec.openapis.org/oas/3.2/dialect");
  });

  it("drops a trailing # so draft meta-schemas match how they are registered", () => {
    expect(normalizeDialect(DRAFT_07_HASH)).toBe("http://json-schema.org/draft-07/schema");
  });

  it("classifies a dialect's referencing model", () => {
    expect(referenceModel(undefined, "3.1")).toBe("2020-12"); // default = OAS dialect
    expect(referenceModel("https://spec.openapis.org/oas/3.1/dialect/base", "3.1")).toBe("2020-12");
    expect(referenceModel("https://spec.openapis.org/oas/3.2/dialect", "3.2")).toBe("2020-12");
    expect(referenceModel(DRAFT_2020_12, "3.1")).toBe("2020-12");
    expect(referenceModel(DRAFT_07, "3.1")).toBe("numbered-draft");
    expect(referenceModel(DRAFT_07_HASH, "3.1")).toBe("numbered-draft"); // trailing # tolerated
    expect(referenceModel(DRAFT_06, "3.1")).toBe("numbered-draft");
    expect(referenceModel(DRAFT_04, "3.1")).toBe("numbered-draft");
    expect(referenceModel(DRAFT_04_HASH, "3.1")).toBe("numbered-draft");
    expect(referenceModel(DRAFT_2019_09, "3.1")).toBe("unsupported");
    expect(referenceModel("https://example.com/custom-dialect", "3.1")).toBe("unsupported");
  });

  it("names the identifier keyword per dialect (draft-04 uses `id`, the rest `$id`)", () => {
    expect(idKeyword(DRAFT_04, "3.1")).toBe("id");
    expect(idKeyword(DRAFT_04_HASH, "3.1")).toBe("id");
    expect(idKeyword(DRAFT_06, "3.1")).toBe("$id");
    expect(idKeyword(DRAFT_07, "3.1")).toBe("$id");
    expect(idKeyword(DRAFT_2020_12, "3.1")).toBe("$id");
    expect(idKeyword("https://spec.openapis.org/oas/3.1/dialect/base", "3.1")).toBe("$id");
    expect(idKeyword(undefined, "3.1")).toBe("$id");
  });

  it("resolves the OAS dialect, 2020-12, and draft-04/06/07; not 2019-09 or unknown dialects", () => {
    expect(isResolutionSupported(undefined, "3.1")).toBe(true); // default = OAS
    expect(isResolutionSupported("https://spec.openapis.org/oas/3.1/dialect/base", "3.1")).toBe(true);
    expect(isResolutionSupported(DRAFT_2020_12, "3.1")).toBe(true);
    expect(isResolutionSupported(`${DRAFT_2020_12}#`, "3.1")).toBe(true);
    expect(isResolutionSupported(DRAFT_07, "3.1")).toBe(true); // now supported
    expect(isResolutionSupported(DRAFT_07_HASH, "3.1")).toBe(true);
    expect(isResolutionSupported(DRAFT_06, "3.1")).toBe(true);
    expect(isResolutionSupported(DRAFT_04, "3.1")).toBe(true);
    expect(isResolutionSupported(DRAFT_2019_09, "3.1")).toBe(false);
    expect(isResolutionSupported("https://example.com/custom-dialect", "3.1")).toBe(false);
  });
});

describe("annotateDialectSupport", () => {
  function findById(root: TreeNode, id: string): TreeNode | undefined {
    if (root.id === id) return root;
    for (const c of root.children) {
      const found = findById(c, id);
      if (found) return found;
    }
    return undefined;
  }

  it("flags only the $schema / jsonSchemaDialect nodes the viewer can't resolve", () => {
    const value = {
      openapi: "3.1.0",
      jsonSchemaDialect: DRAFT_2019_09, // unsupported → flagged
      info: { title: "T", version: "1" },
      components: {
        schemas: {
          A: { $schema: DRAFT_2020_12, type: "object" }, // supported → not flagged
          B: { $schema: DRAFT_2019_09, type: "object" }, // unsupported → flagged
          C: { type: "object" }, // no $schema
          D: { $schema: DRAFT_07_HASH, type: "object" }, // draft-07 now supported → not flagged
        },
      },
    };
    const root = buildTree(value);
    classifyDocument(root, "3.1");
    annotateDialectSupport(root, "3.1");

    expect(findById(root, "/jsonSchemaDialect")?.dialectResolutionWarning).toMatch(/2019-09/);
    expect(findById(root, "/components/schemas/A/$schema")?.dialectResolutionWarning).toBeUndefined();
    expect(findById(root, "/components/schemas/B/$schema")?.dialectResolutionWarning).toMatch(/2019-09/);
    expect(findById(root, "/components/schemas/D/$schema")?.dialectResolutionWarning).toBeUndefined();
  });
});
