import { describe, it, expect } from "vitest";
import {
  annotateDialectSupport,
  isOasDialect,
  isResolutionSupported,
  normalizeDialect,
  oasDialectUri,
} from "../../src/oas/dialects";
import { buildTree } from "../../src/model/treeBuilder";
import { classifyDocument } from "../../src/oas/classify";
import type { TreeNode } from "../../src/types";

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

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
    expect(normalizeDialect("http://json-schema.org/draft-07/schema#")).toBe(
      "http://json-schema.org/draft-07/schema",
    );
  });

  it("treats only the OAS dialect and 2020-12 as fully resolvable", () => {
    expect(isResolutionSupported(undefined, "3.1")).toBe(true); // default = OAS
    expect(isResolutionSupported("https://spec.openapis.org/oas/3.1/dialect/base", "3.1")).toBe(true);
    expect(isResolutionSupported(DRAFT_2020_12, "3.1")).toBe(true);
    expect(isResolutionSupported(`${DRAFT_2020_12}#`, "3.1")).toBe(true);
    expect(isResolutionSupported(DRAFT_07, "3.1")).toBe(false);
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
      jsonSchemaDialect: DRAFT_07, // unsupported → flagged
      info: { title: "T", version: "1" },
      components: {
        schemas: {
          A: { $schema: DRAFT_2020_12, type: "object" }, // supported → not flagged
          B: { $schema: DRAFT_07, type: "object" }, // unsupported → flagged
          C: { type: "object" }, // no $schema
        },
      },
    };
    const root = buildTree(value);
    classifyDocument(root, "3.1");
    annotateDialectSupport(root, "3.1");

    expect(findById(root, "/jsonSchemaDialect")?.dialectResolutionWarning).toMatch(/draft-07/);
    expect(findById(root, "/components/schemas/A/$schema")?.dialectResolutionWarning).toBeUndefined();
    expect(findById(root, "/components/schemas/B/$schema")?.dialectResolutionWarning).toMatch(/draft-07/);
  });
});
