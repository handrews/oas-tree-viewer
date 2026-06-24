import { describe, it, expect } from "vitest";
import { makeDoc, makeOad, makeInput, loadOad } from "../helpers";
import { resolveOad } from "../../src/refs/resolver";
import { SchemaValidationError } from "../../src/errors";
import type { TreeNode } from "../../src/types";

// OAS 3.0 is simpler than 3.1/3.2: Schema Objects are NOT JSON Schema (no `$id`/`$anchor`/dynamic; a
// Schema `$ref` is a plain Reference Object), and a document validates against the single 3.0 schema
// (no dialect selection / per-resource meta-validation).

/** Find a node by JSON Pointer (decoding `~1`/`~0`). */
function nodeAt(root: TreeNode, pointer: string): TreeNode | undefined {
  if (pointer === "") return root;
  let cur: TreeNode | undefined = root;
  for (const seg of pointer.split("/").slice(1)) {
    const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
    cur = cur?.children.find((c) => c.key === key);
  }
  return cur;
}

const ENTRY = `
openapi: 3.0.4
info: { title: Petstore, version: '1.0' }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: a list of pets
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Pet' }
components:
  schemas:
    Pet:
      type: object
      required: [name]
      properties:
        name: { type: string }
        friend: { $ref: '#/components/schemas/Pet' }
`;

describe("OAS 3.0 — detection, family, classification, validation", () => {
  it("detects a 3.0 document (family 3.0), classifies it, and validates with no dialect warning", async () => {
    const doc = await makeDoc(ENTRY, { isEntry: true });
    expect(doc.kind).toBe("openapi");
    expect(doc.oasVersion).toBe("3.0.4");
    expect(makeOad(doc).versionFamily).toBe("3.0");

    expect(doc.root.oasType).toBe("OpenAPI Object");
    expect(nodeAt(doc.root, "/paths/~1pets/get")?.oasType).toBe("Operation Object");
    expect(nodeAt(doc.root, "/components/schemas/Pet")?.oasType).toBe("Schema Object");
    // 3.0 schemas are covered by the single 3.0 schema — no per-resource dialect pass / warning.
    expect(doc.schemaDialect).toBeUndefined();
    expect(doc.schemaDialectWarning).toBeUndefined();
  });

  it("rejects a structurally-invalid 3.0 document with located violations", async () => {
    // `info` is missing its required `title`/`version`.
    await expect(
      makeDoc("openapi: 3.0.4\ninfo: {}\npaths: {}\n", { isEntry: true }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it("rejects mixing a 3.0 document with a 3.1 document", async () => {
    await expect(
      loadOad(
        makeInput("openapi: 3.0.4\ninfo: { title: A, version: '1' }\npaths: {}\n", {
          isEntry: true,
        }),
        makeInput("openapi: 3.1.0\ninfo: { title: B, version: '1' }\npaths: {}\n", {}),
      ),
    ).rejects.toThrow(/mixes OAS versions/i);
  });
});

describe("OAS 3.0 — Schema Objects are not JSON Schema", () => {
  it("classifies a Schema `$ref` as a Reference Object and resolves it as a URI-reference", async () => {
    const doc = await makeDoc(ENTRY, { isEntry: true });
    const friend = nodeAt(doc.root, "/components/schemas/Pet/properties/friend")!;
    expect(friend.oasType).toBe("Reference Object"); // not a Schema with siblings (that is 3.1/3.2)
    expect(friend.isReference).toBe(true);
    expect(friend.expectedType).toBe("Schema");

    const { edges } = resolveOad(makeOad(doc));
    const edge = edges.find((e) => e.sourceObjectId === friend.id);
    expect(edge?.status).toBe("resolved");
    expect(edge?.resolution).toBe("uri-reference"); // a plain Reference, never a dynamic/anchor target
    expect(edge?.targetNodeId).toBe(nodeAt(doc.root, "/components/schemas/Pet")!.id);
  });

  it("resolves a 3.0 cross-document Reference Object", async () => {
    const A = `
openapi: 3.0.4
info: { title: A, version: '1.0' }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: 'b.yaml#/components/schemas/Pet' }
`;
    const B = `
openapi: 3.0.4
info: { title: B, version: '1.0' }
paths: {}
components:
  schemas:
    Pet: { type: object, properties: { name: { type: string } } }
`;
    const oad = await loadOad(
      makeInput(A, { filename: "a.yaml", retrievalUri: "https://ex.test/a.yaml", isEntry: true }),
      makeInput(B, { filename: "b.yaml", retrievalUri: "https://ex.test/b.yaml" }),
    );
    expect(oad.versionFamily).toBe("3.0");
    const { edges } = resolveOad(oad);
    const cross = edges.find((e) => e.sourceDocId !== e.targetDocId && e.targetDocId != null);
    expect(cross?.status).toBe("resolved");
    expect(cross?.resolution).toBe("uri-reference");
  });
});
