import { describe, it, expect, beforeAll } from "vitest";
import type { TreeNode } from "../../src/types";
import { makeDoc } from "../helpers";

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
    application/json: { schema: { type: object } }
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
