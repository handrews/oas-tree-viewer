import { describe, it, expect } from "vitest";
import { detectDocument } from "../src/loader";
import { resolveOad } from "../src/refs/resolver";
import { NotOpenApiError, SchemaValidationError } from "../src/errors";
import { makeDoc, makeInput, makeOad, loadOad } from "./helpers";

// v0.5.0 phase 1: a document whose root is a Schema Object is a standalone JSON Schema document.
// It is detected by a root `$id`/`$schema`, classified from the `Schema` descriptor, validated by its
// dialect (its `$schema`, else the OAD's borrowed OAS dialect, else left unvalidated), and resolved
// with the version-independent 2020-12 model.

const STANDALONE = `
$schema: https://json-schema.org/draft/2020-12/schema
$id: https://example.com/schemas/pet
title: Pet
type: object
properties:
  name: { type: string }
  friend: { $ref: '#/$defs/pet' }
required: [name]
$defs:
  pet:
    type: object
    properties:
      name: { type: string }
`;

describe("JSON Schema document — detection", () => {
  it("treats a $schema/$id root as a schema document (even with an openapi field present)", async () => {
    const d = await detectDocument(
      makeInput("openapi: 3.1.0\n$schema: https://json-schema.org/draft/2020-12/schema\n"),
    );
    expect(d.kind).toBe("schema");
    expect(d.rootSchema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("treats a $id-only root (no $schema) as a schema document", async () => {
    const d = await detectDocument(makeInput("$id: https://example.com/s\ntype: object\n"));
    expect(d.kind).toBe("schema");
    expect(d.rootSchema).toBeUndefined();
  });

  it("treats a root openapi field as a complete OpenAPI document", async () => {
    const d = await detectDocument(
      makeInput("openapi: 3.1.0\ninfo: { title: T, version: '1.0' }\npaths: {}\n"),
    );
    expect(d.kind).toBe("openapi");
    expect(d.oasVersion).toBe("3.1.0");
  });

  it("rejects a draft-04-style bare `id` root (too generic to be a signal)", async () => {
    await expect(
      detectDocument(makeInput("id: https://example.com/s\ntype: object\n")),
    ).rejects.toBeInstanceOf(NotOpenApiError);
  });

  it("rejects a document that is neither OpenAPI nor JSON Schema", async () => {
    await expect(
      detectDocument(makeInput("title: just data\ntype: object\n")),
    ).rejects.toBeInstanceOf(NotOpenApiError);
  });
});

describe("JSON Schema document — classification, validation, resolution", () => {
  it("classifies the root as a Schema Object and resolves an internal $ref", async () => {
    const doc = await makeDoc(STANDALONE, { isEntry: true });
    expect(doc.kind).toBe("schema");
    expect(doc.root.oasType).toBe("Schema Object");
    expect(doc.schemaDialect).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(doc.schemaDialectWarning).toBeUndefined();

    const refs = resolveOad(makeOad(doc));
    const edge = refs.edges.find((e) => e.refString === "#/$defs/pet");
    expect(edge?.status).toBe("resolved");
    expect(edge?.targetNodeId).toBe("/$defs/pet");
  });

  it("rejects a schema-invalid document with a SchemaValidationError", async () => {
    await expect(
      makeDoc("$schema: https://json-schema.org/draft/2020-12/schema\ntype: 123\n", {
        isEntry: true,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });
});

describe("JSON Schema document — version borrowing", () => {
  // A `$schema`-less schema document referenced by an OpenAPI document borrows that OAD's OAS dialect.
  const ENTRY = `
openapi: 3.1.0
info: { title: T, version: '1.0' }
paths: {}
components:
  schemas:
    Pet:
      $ref: 'https://example.com/schemas/pet'
`;
  const SCHEMA = `
$id: https://example.com/schemas/pet
type: object
properties:
  name: { type: string }
  friend: { $ref: '#/$defs/pet' }
$defs:
  pet: { type: object }
`;

  it("borrows the OAS dialect, validates, and resolves a cross-document $ref to the root $id", async () => {
    const oad = await loadOad(
      makeInput(ENTRY, { isEntry: true, retrievalUri: "https://example.com/openapi.yaml" }),
      makeInput(SCHEMA, { retrievalUri: "https://example.com/schemas/pet.json" }),
    );
    const schemaDoc = oad.documents.find((d) => d.kind === "schema")!;
    expect(schemaDoc.schemaDialect).toBe("https://spec.openapis.org/oas/3.1/dialect/base");
    expect(schemaDoc.schemaDialectWarning).toBeUndefined();

    const refs = resolveOad(oad);
    const crossDoc = refs.edges.find((e) => e.refString === "https://example.com/schemas/pet");
    expect(crossDoc?.status).toBe("resolved");
    expect(crossDoc?.targetDocId).toBe(schemaDoc.id);

    const internal = refs.edges.find((e) => e.refString === "#/$defs/pet");
    expect(internal?.status).toBe("resolved");
  });
});

describe("JSON Schema document — no determinable version", () => {
  // A standalone `$schema`-less document has no OAS version to borrow: it is left unvalidated (flagged)
  // but still classifies and resolves with the 2020-12 model.
  const NOVERSION = `
$id: https://example.com/schemas/thing
type: object
properties:
  whole: { $ref: '#' }
  leaf: { $ref: '#/$defs/leaf' }
$defs:
  leaf: { type: string }
`;

  it("leaves the document unvalidated but still resolves its references", async () => {
    const doc = await makeDoc(NOVERSION, { isEntry: true });
    expect(doc.kind).toBe("schema");
    expect(doc.schemaDialect).toBeUndefined();
    expect(doc.schemaDialectWarning).toBeDefined();

    const refs = resolveOad(makeOad(doc));
    const leaf = refs.edges.find((e) => e.refString === "#/$defs/leaf");
    expect(leaf?.status).toBe("resolved");
    expect(leaf?.targetNodeId).toBe("/$defs/leaf");
  });
});
