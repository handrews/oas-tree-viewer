import { describe, it, expect, beforeAll } from "vitest";
import type { TreeNode } from "../../src/types";
import { makeDoc } from "../helpers";
import { buildTree } from "../../src/model/treeBuilder";
import { classifyAsGeneric, classifyDocument } from "../../src/oas/classify";

const DOC = `
openapi: 3.2.0
$self: https://e/x
info: { title: T, version: '1' }
x-custom: { anything: 1 }
paths:
  /a:
    get:
      operationId: op
      parameters:
        - name: p
          in: query
          schema: { type: string }
        - $ref: '#/components/parameters/Ref'
      responses:
        '200': { description: ok }
    query:
      operationId: q
      responses: { '200': { description: ok } }
    additionalOperations:
      PURGE:
        operationId: purge
        responses: { '204': { description: gone } }
components:
  mediaTypes:
    Json: { schema: { type: object } }
  parameters:
    Ref: { name: r, in: query, schema: { type: integer } }
  schemas:
    S:
      type: object
      allOf:
        - type: object
      properties:
        x: { type: string }
`;

let root: TreeNode;

function at(pointer: string): TreeNode | undefined {
  const find = (n: TreeNode): TreeNode | undefined => {
    if (n.id === pointer) return n;
    for (const c of n.children) {
      const r = find(c);
      if (r) return r;
    }
    return undefined;
  };
  return find(root);
}

beforeAll(async () => {
  root = (await makeDoc(DOC)).root;
});

describe("classifyDocument", () => {
  it("types the root and common objects", () => {
    expect(root.oasType).toBe("OpenAPI Object");
    expect(root.expectedType).toBe("OpenApi");
    expect(at("/info")?.oasType).toBe("Info Object");
    expect(at("/paths")?.oasType).toBe("Paths Object");
    expect(at("/paths/~1a")?.oasType).toBe("Path Item Object");
    expect(at("/paths/~1a/get")?.oasType).toBe("Operation Object");
    expect(at("/paths/~1a/get/responses")?.oasType).toBe("Responses Object");
  });

  it("sets expectedType (slot type), inherited by Reference Objects", () => {
    expect(at("/paths/~1a/get/parameters/0")?.expectedType).toBe("Parameter");
    const ref = at("/paths/~1a/get/parameters/1")!;
    expect(ref.oasType).toBe("Reference Object");
    expect(ref.expectedType).toBe("Parameter");
    expect(ref.isReference).toBe(true);
    expect(ref.refTarget).toBe("#/components/parameters/Ref");
    // A Reference Object is colored as the type it stands in for (Parameter -> http), not
    // as a structural node; the asterisk marker on its `$ref` row carries the reference cue.
    expect(ref.category).toBe("http");
  });

  it("recognizes 3.2 additions", () => {
    expect(at("/paths/~1a/query")?.oasType).toBe("Operation Object");
    expect(at("/paths/~1a/additionalOperations")?.oasType).toBe("Map of Operation Object");
    expect(at("/paths/~1a/additionalOperations/PURGE")?.oasType).toBe("Operation Object");
    expect(at("/components/mediaTypes")?.oasType).toBe("Map of Media Type Object");
  });

  it("classifies schema keywords", () => {
    expect(at("/components/schemas/S")?.oasType).toBe("Schema Object");
    expect(at("/components/schemas/S/allOf")?.oasType).toBe("Array of Schema Object");
    expect(at("/components/schemas/S/allOf/0")?.oasType).toBe("Schema Object");
    expect(at("/components/schemas/S/properties/x")?.oasType).toBe("Schema Object");
  });

  it("leaves extension fields generic", () => {
    const x = at("/x-custom")!;
    expect(x.oasType).toBeUndefined();
    expect(x.category).toBe("object");
  });
});

// Direct buildTree + classifyDocument reaches the classifier branches the validating pipeline (makeDoc)
// rejects before it runs — a grammar field given the wrong JSON kind, and the generic fallbacks.

function find(root: TreeNode, pointer: string): TreeNode | undefined {
  if (root.id === pointer) return root;
  for (const c of root.children) {
    const r = find(c, pointer);
    if (r) return r;
  }
  return undefined;
}

/** A minimal OpenAPI value with extra (possibly off-grammar) fields merged in. */
function oapi(extra: Record<string, unknown>): Record<string, unknown> {
  return { openapi: "3.1.0", info: { title: "t", version: "1" }, paths: {}, ...extra };
}

describe("classifyDocument — fallbacks for off-grammar shapes", () => {
  it("defaults the document kind to OpenAPI when none is given", () => {
    const root = buildTree(oapi({}));
    classifyDocument(root, "3.1"); // kind omitted -> "openapi"
    expect(root.oasType).toBe("OpenAPI Object");
    expect(root.expectedType).toBe("OpenApi");
  });

  it("falls back to structural when a Schema slot holds a non-object", () => {
    // `additionalProperties` expects a Schema; a boolean is valid JSON Schema but not an object.
    const root = buildTree(
      oapi({ components: { schemas: { X: { additionalProperties: false } } } }),
    );
    classifyDocument(root, "3.1");
    const node = find(root, "/components/schemas/X/additionalProperties")!;
    expect(node.valueKind).toBe("boolean");
    expect(node.oasType).toBeUndefined();
    expect(node.category).toBe("scalar");
  });

  it("falls back to structural when an array field holds a non-array", () => {
    const root = buildTree(oapi({ tags: "not-an-array" }));
    classifyDocument(root, "3.1");
    const node = find(root, "/tags")!;
    expect(node.valueKind).toBe("string");
    expect(node.oasType).toBeUndefined();
  });

  it("falls back to structural when a map field holds a non-object", () => {
    const root = buildTree(oapi({ components: { schemas: [] } }));
    classifyDocument(root, "3.1");
    const node = find(root, "/components/schemas")!;
    expect(node.valueKind).toBe("array");
    expect(node.oasType).toBeUndefined();
  });

  it("handles a Discriminator mapping that isn't an object, and skips non-string values when it is", () => {
    const root = buildTree(
      oapi({
        components: {
          schemas: {
            BadMap: { discriminator: { propertyName: "t", mapping: "not-an-object" } },
            Mixed: { discriminator: { propertyName: "t", mapping: { ok: "#/c/Cat", bad: 7 } } },
          },
        },
      }),
    );
    classifyDocument(root, "3.1");

    // A non-object mapping → structural, with no component refs underneath.
    const bad = find(root, "/components/schemas/BadMap/discriminator/mapping")!;
    expect(bad.valueKind).toBe("string");
    expect(bad.oasType).toBeUndefined();

    // An object mapping: string values become component refs; a non-string value is skipped (generic).
    const ok = find(root, "/components/schemas/Mixed/discriminator/mapping/ok")!;
    expect(ok.componentRef).toMatchObject({
      refString: "#/c/Cat",
      expectedType: "Schema",
      field: "mapping",
    });
    const nonString = find(root, "/components/schemas/Mixed/discriminator/mapping/bad")!;
    expect(nonString.componentRef).toBeUndefined();
    expect(nonString.category).toBe("scalar");
  });
});

describe("classifyAsGeneric", () => {
  it("assigns only structural categories, no OAS types", () => {
    const root = buildTree({ a: { b: 1 }, c: [true, "x"] });
    classifyAsGeneric(root);
    expect(root.oasType).toBeUndefined();
    expect(root.category).toBe("object");
    expect(find(root, "/a")!.category).toBe("object");
    expect(find(root, "/a/b")!.category).toBe("scalar");
    expect(find(root, "/c")!.category).toBe("array");
    expect(find(root, "/c/0")!.category).toBe("scalar");
  });
});
