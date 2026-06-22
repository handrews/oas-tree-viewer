import { describe, it, expect, vi } from "vitest";
import { validateOad, selectValidationSchema } from "../../src/validation/validateOad";
import { buildTree } from "../../src/model/treeBuilder";
import { classifyDocument } from "../../src/oas/classify";
import type { TreeNode, VersionFamily } from "../../src/types";

// Validation must never touch the network — the OAS schemas are bundled with the validator.
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

const OAS_31_DIALECT = "https://spec.openapis.org/oas/3.1/dialect/base";
const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

describe("selectValidationSchema (pure dialect selection)", () => {
  it("defaults (absent dialect) to the OAS schema-base", () => {
    expect(selectValidationSchema(undefined, [], "3.1")).toEqual({
      entryUri: "https://spec.openapis.org/oas/3.1/schema-base",
    });
  });

  it("uses the 2020-12 variant when the document declares plain 2020-12", () => {
    expect(selectValidationSchema(DRAFT_2020_12, [], "3.1")).toEqual({
      entryUri: "https://spec.openapis.org/oas/3.1/schema-draft-2020-12",
    });
  });

  it("treats any dated/base OAS dialect URI as the OAS dialect", () => {
    expect(selectValidationSchema("https://spec.openapis.org/oas/3.1/dialect/2024-11-10", [], "3.1").entryUri).toBe(
      "https://spec.openapis.org/oas/3.1/schema-base",
    );
  });

  it("falls back to loose + warning for an unsupported document dialect", () => {
    const r = selectValidationSchema("https://json-schema.org/draft-07/schema", [], "3.1");
    expect(r.entryUri).toBe("https://spec.openapis.org/oas/3.1/schema");
    expect(r.dialectWarning).toMatch(/can't yet validate/i);
  });

  it("falls back to loose when a Schema Object overrides $schema with an unsupported dialect", () => {
    const r = selectValidationSchema(undefined, ["https://json-schema.org/draft-07/schema"], "3.1");
    expect(r.entryUri).toBe("https://spec.openapis.org/oas/3.1/schema");
    expect(r.dialectWarning).toBeDefined();
  });

  it("stays deep when a Schema Object override is itself a supported dialect", () => {
    expect(selectValidationSchema(OAS_31_DIALECT, [DRAFT_2020_12], "3.1")).toEqual({
      entryUri: "https://spec.openapis.org/oas/3.1/schema-base",
    });
  });
});

describe("validateOad (offline, deep)", () => {
  it("accepts a valid 3.1 document", async () => {
    const good = {
      openapi: "3.1.0",
      info: { title: "Good", version: "1.0.0" },
      components: { schemas: { Pet: { type: "object", properties: { id: { type: "integer" } } } } },
    };
    const { violations, dialectWarning } = await validate(good);
    expect(violations).toEqual([]);
    expect(dialectWarning).toBeUndefined();
  });

  it("catches a malformed Schema Object and locates it by JSON Pointer", async () => {
    const bad = {
      openapi: "3.1.0",
      info: { title: "Bad", version: "1.0.0" },
      components: { schemas: { Pet: { type: "strang" } } },
    };
    const { violations } = await validate(bad);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.pointer === "/components/schemas/Pet/type")).toBe(true);
  });

  it("catches a missing required envelope field", async () => {
    const noInfo = { openapi: "3.1.0", paths: {} };
    const { violations } = await validate(noInfo);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.keywords.includes("required"))).toBe(true);
  });

  it("validates a 3.2 document the same way", async () => {
    const bad = {
      openapi: "3.2.0",
      info: { title: "Bad", version: "1.0.0" },
      components: { schemas: { X: { type: "strang" } } },
    };
    const { violations } = await validate(bad, "3.2");
    expect(violations.some((v) => v.pointer === "/components/schemas/X/type")).toBe(true);
  });
});

describe("validateOad (dialect fallback)", () => {
  it("validates Schema Objects deeply under an explicit 2020-12 dialect", async () => {
    const bad2020 = {
      openapi: "3.1.0",
      jsonSchemaDialect: DRAFT_2020_12,
      info: { title: "t", version: "1" },
      components: { schemas: { Pet: { type: "strang" } } },
    };
    const { violations, dialectWarning } = await validate(bad2020);
    expect(dialectWarning).toBeUndefined();
    expect(violations.some((v) => v.pointer === "/components/schemas/Pet/type")).toBe(true);
  });

  it("falls back to loose validation + warning for an unsupported dialect", async () => {
    const unknownDialect = {
      openapi: "3.1.0",
      jsonSchemaDialect: "https://json-schema.org/draft-07/schema",
      info: { title: "t", version: "1" },
      components: { schemas: { Pet: { type: "strang" } } }, // would fail deep, but loose ignores it
    };
    const { violations, dialectWarning } = await validate(unknownDialect);
    expect(dialectWarning).toMatch(/draft-07/);
    expect(violations).toEqual([]);
  });
});

describe("validateOad offline guarantee", () => {
  it("never calls fetch", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
