import { describe, it, expect, beforeAll } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";
import { makeDoc, makeOad } from "../helpers";
import type { OadDocument, TreeNode } from "../../src/types";

// draft-06/07 referencing & identification: anchors come from `$id` fragments (not `$anchor`),
// `$ref` siblings are ignored (warned), and a JSON-Pointer `$id` fragment must be the schema's own
// location. `Catalog` is a draft-07 resource (the document default via `jsonSchemaDialect`); `Modern`
// re-declares 2020-12, where `$anchor` still works.
const DOC = `
openapi: 3.1.0
info: { title: Draft drafts, version: '1.0' }
jsonSchemaDialect: 'http://json-schema.org/draft-07/schema#'
paths:
  /catalog:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Catalog' }
components:
  schemas:
    Catalog:
      $id: https://example.com/draft/catalog
      type: object
      properties:
        viaAnchor: { $ref: 'https://example.com/draft/catalog#thing' }
        viaPointer: { $ref: 'https://example.com/draft/catalog#/properties/selfPointed' }
        viaGhost: { $ref: 'https://example.com/draft/catalog#ghost' }
        viaModernAnchor: { $ref: 'https://example.com/modern#leaf' }
        withSiblings:
          $ref: '#/properties/thing'
          type: string
          description: ignored under draft-07
        thing:
          $id: '#thing'
          type: string
        selfPointed:
          $id: '#/properties/selfPointed'
          type: integer
        misPointed:
          $id: '#/properties/nope'
          type: boolean
        notAnchor:
          $anchor: ghost
          type: string
    Modern:
      $id: https://example.com/modern
      $schema: https://json-schema.org/draft/2020-12/schema
      type: object
      properties:
        leaf: { $anchor: leaf, type: string }
`;

const P = "/components/schemas/Catalog";

function at(root: TreeNode, pointer: string): TreeNode {
  const find = (n: TreeNode): TreeNode | undefined => {
    if (n.id === pointer) return n;
    for (const c of n.children) {
      const r = find(c);
      if (r) return r;
    }
    return undefined;
  };
  const found = find(root);
  if (!found) throw new Error(`no node at ${pointer}`);
  return found;
}

describe("draft-06/07 reference & identification semantics", () => {
  let refs: ResolvedRefs;
  let doc: OadDocument;
  const byRef = (refString: string): ReferenceEdge =>
    refs.edges.find((e) => e.refString === refString)!;

  beforeAll(async () => {
    doc = await makeDoc(DOC, { isEntry: true, retrievalUri: "https://example.com/draft/entry.yaml" });
    refs = resolveOad(makeOad(doc));
  });

  it("resolves a `$ref` to a plain-name `$id`-fragment anchor", () => {
    const e = byRef("https://example.com/draft/catalog#thing");
    expect(e.status).toBe("resolved");
    expect(e.targetNodeId).toBe(`${P}/properties/thing`);
  });

  it("resolves a `$ref` to a JSON-Pointer fragment", () => {
    const e = byRef("https://example.com/draft/catalog#/properties/selfPointed");
    expect(e.status).toBe("resolved");
    expect(e.targetNodeId).toBe(`${P}/properties/selfPointed`);
  });

  it("does not treat `$anchor` as an anchor inside a draft-07 resource (the `$ref` is broken)", () => {
    expect(byRef("https://example.com/draft/catalog#ghost").status).toBe("broken");
  });

  it("leaves the 2020-12 resource's `$anchor` working (other dialects unaffected)", () => {
    const e = byRef("https://example.com/modern#leaf");
    expect(e.status).toBe("resolved");
    expect(e.targetNodeId).toBe("/components/schemas/Modern/properties/leaf");
  });

  it("warns about ignored `$ref` siblings but still draws the arc", () => {
    expect(byRef("#/properties/thing").status).toBe("resolved");
    const advisories = at(doc.root, `${P}/properties/withSiblings/$ref`).resolutionAdvisories ?? [];
    expect(advisories.map((a) => a.code)).toEqual(["ignored-ref-siblings"]);
    expect(advisories[0]!.detail).toMatch(/ignored: type, description/);
  });

  it("flags an `$id` JSON-Pointer fragment that isn't the schema's own location", () => {
    const advisories = at(doc.root, `${P}/properties/misPointed/$id`).resolutionAdvisories ?? [];
    expect(advisories.map((a) => a.code)).toEqual(["invalid-id-fragment"]);
  });

  it("leaves a correct `$id` JSON-Pointer fragment and a plain-name `$id` unflagged", () => {
    expect(at(doc.root, `${P}/properties/selfPointed/$id`).resolutionAdvisories).toBeUndefined();
    expect(at(doc.root, `${P}/properties/thing/$id`).resolutionAdvisories).toBeUndefined();
  });
});
