import { describe, it, expect, vi } from "vitest";
import { validateOad } from "../../src/validation/validateOad";
import { buildTree } from "../../src/model/treeBuilder";
import { classifyDocument } from "../../src/oas/classify";
import type { TreeNode, VersionFamily } from "../../src/types";

// Validation must never touch the network — the OAS + draft schemas are bundled with the validator.
// Install a throwing `fetch` before the first validateOad call (which lazily imports Hyperjump).
const fetchSpy = vi.fn(() => {
  throw new Error("network fetch during schema validation");
});
globalThis.fetch = fetchSpy as unknown as typeof fetch;

function classified(value: unknown, version: VersionFamily = "3.1"): TreeNode {
  const root = buildTree(value);
  classifyDocument(root, version);
  return root;
}
const validate = (value: unknown, version: VersionFamily = "3.1") =>
  validateOad(value, classified(value, version), version);

const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

const doc = (extra: Record<string, unknown>) => ({
  openapi: "3.1.0",
  info: { title: "T", version: "1.0.0" },
  ...extra,
});
const schemas = (s: Record<string, unknown>) => doc({ components: { schemas: s } });
const ptrs = (vs: { pointer: string }[]) => vs.map((v) => v.pointer);

describe("validateOad — envelope + OAS-dialect Schema Objects", () => {
  it("accepts a valid 3.1 document", async () => {
    const { violations, dialectWarning } = await validate(
      schemas({ Pet: { type: "object", properties: { id: { type: "integer" } } } }),
    );
    expect(violations).toEqual([]);
    expect(dialectWarning).toBeUndefined();
  });

  it("catches a malformed Schema Object, located by JSON Pointer", async () => {
    const { violations } = await validate(schemas({ Pet: { type: "strang" } }));
    expect(ptrs(violations)).toContain("/components/schemas/Pet/type");
  });

  it("catches a missing required envelope field", async () => {
    const { violations } = await validate({ openapi: "3.1.0", paths: {} });
    expect(violations.some((v) => v.keywords.includes("required"))).toBe(true);
  });

  it("validates a 3.2 document the same way", async () => {
    const { violations } = await validate(schemas({ X: { type: "strang" } }), "3.2");
    expect(ptrs(violations)).toContain("/components/schemas/X/type");
  });
});

describe("validateOad — per-resource dialects", () => {
  it("validates each Schema Object against its own $schema (2020-12 vs OAS default)", async () => {
    const { violations } = await validate(
      schemas({
        Good: { type: "object" }, // OAS default — fine
        Bad2020: { $schema: DRAFT_2020_12, type: "strang" }, // 2020-12 — invalid
      }),
    );
    expect(ptrs(violations)).toContain("/components/schemas/Bad2020/type");
    expect(violations.every((v) => !v.pointer.startsWith("/components/schemas/Good"))).toBe(true);
  });

  it("validates a draft-07 Schema Object against draft-07", async () => {
    const { violations, dialectWarning } = await validate(
      schemas({ Legacy: { $schema: DRAFT_07, type: "strang" } }),
    );
    expect(dialectWarning).toBeUndefined();
    expect(ptrs(violations)).toContain("/components/schemas/Legacy/type");
  });

  it("honors a document-level jsonSchemaDialect of 2020-12", async () => {
    const { violations } = await validate(
      doc({
        jsonSchemaDialect: DRAFT_2020_12,
        components: { schemas: { Pet: { type: "strang" } } },
      }),
    );
    expect(ptrs(violations)).toContain("/components/schemas/Pet/type");
  });

  it("skips an unknown dialect with a warning instead of failing", async () => {
    const { violations, dialectWarning } = await validate(
      schemas({ Old: { $schema: "http://json-schema.org/draft-03/schema#", type: "strang" } }),
    );
    expect(dialectWarning).toMatch(/draft-03/);
    expect(violations.every((v) => !v.pointer.startsWith("/components/schemas/Old"))).toBe(true);
  });
});

describe("validateOad — safety", () => {
  it("still validates a Schema Object that has a broken/external $ref (no ref resolution)", async () => {
    const { violations } = await validate(
      schemas({
        Ref: {
          type: "object",
          properties: { x: { $ref: "https://nowhere.example/missing#/foo" } },
        },
      }),
    );
    expect(violations).toEqual([]);
  });

  it("never calls fetch", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
