import { describe, it, expect, beforeAll } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";
import { makeDoc, makeOad } from "../helpers";
import type { OadDocument } from "../../src/types";

// 2019-09 `$recursiveRef`/`$recursiveAnchor`: the simplified, ANONYMOUS form of `$dynamicRef`.
// GenericTree's `$recursiveRef "#"` engages recursive scope (its resource declares
// `$recursiveAnchor: true`) and fans out to the outermost `$recursiveAnchor: true` resources on the
// entry-rooted paths — here StrictTree and LooseTree, which the entry reaches and which each extend
// GenericTree. PlainTree has no `$recursiveAnchor`, so its `$recursiveRef "#"` is a static self-ref.
const DOC = `
openapi: 3.1.0
info: { title: Recursive, version: '1.0' }
jsonSchemaDialect: 'https://json-schema.org/draft/2019-09/schema'
paths:
  /strict:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/StrictTree' }
  /loose:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/LooseTree' }
  /plain:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PlainTree' }
components:
  schemas:
    GenericTree:
      $id: https://example.com/recursive/generic
      $recursiveAnchor: true
      type: object
      properties:
        child: { $recursiveRef: '#' }
    StrictTree:
      $id: https://example.com/recursive/strict
      $recursiveAnchor: true
      allOf:
        - $ref: 'https://example.com/recursive/generic'
    LooseTree:
      $id: https://example.com/recursive/loose
      $recursiveAnchor: true
      allOf:
        - $ref: 'https://example.com/recursive/generic'
    PlainTree:
      $id: https://example.com/recursive/plain
      type: object
      properties:
        child: { $recursiveRef: '#' }
        # The anonymous recursive anchor must be UNREACHABLE by name — this resolves to nothing.
        viaName: { $ref: 'https://example.com/recursive/generic#anything' }
`;

describe("draft-2019-09 $recursiveRef / $recursiveAnchor", () => {
  let refs: ResolvedRefs;
  const recRefs = (): ReferenceEdge[] => refs.edges.filter((e) => e.kind === "$recursiveRef");

  beforeAll(async () => {
    const doc: OadDocument = await makeDoc(DOC, {
      isEntry: true,
      retrievalUri: "https://example.com/recursive/entry.yaml",
    });
    refs = resolveOad(makeOad(doc));
  });

  it("fans an engaged $recursiveRef out to every outermost recursive-anchor on an entry-rooted path", () => {
    const dynamic = recRefs().filter((e) => e.resolution === "dynamic");
    expect(dynamic).toHaveLength(2);
    for (const e of dynamic) expect(e.status).toBe("resolved");
    expect(dynamic.map((e) => e.targetNodeId).sort()).toEqual([
      "/components/schemas/LooseTree",
      "/components/schemas/StrictTree",
    ]);
  });

  it("treats a $recursiveRef with no $recursiveAnchor in scope as a static self-reference", () => {
    const staticRec = recRefs().filter((e) => e.resolution === "uri-reference");
    expect(staticRec).toHaveLength(1);
    expect(staticRec[0]!.status).toBe("resolved");
    expect(staticRec[0]!.targetNodeId).toBe("/components/schemas/PlainTree");
  });

  it("never exposes the anonymous recursive anchor as a named fragment (no spurious URI key)", () => {
    // A `$ref` with any plain-name fragment into the recursive resource finds nothing: the anchor was
    // tracked only by sentinel name + base-URI set, never as `${base}#${name}`.
    const named = refs.edges.find(
      (e) => e.refString === "https://example.com/recursive/generic#anything",
    );
    expect(named?.status).toBe("broken");
  });
});
