import { describe, it, expect, beforeAll } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import { refKey } from "../../src/refs/types";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";
import { makeDoc, makeOad } from "../helpers";

// Entry document exercising every reference location and outcome.
const ENTRY = `
openapi: 3.1.0
$self: https://example.com/oad/entry.yaml
info: { title: Entry, version: '1.0' }
paths:
  /pets:
    $ref: shared.yaml#/components/pathItems/Common
  /links:
    get:
      operationId: getLinks
      parameters:
        - $ref: shared.yaml#/components/parameters/SharedLimit
        - $ref: '#/components/schemas/Thing'
        - $ref: '#/components/parameters/Missing'
        - $ref: https://elsewhere.example/api.yaml#/components/parameters/Foo
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: https://example.com/schemas/pet#PetAnchor
          links:
            self: { operationRef: '#/paths/~1links/get' }
            wrong: { operationRef: '#/components/schemas/Thing' }
components:
  schemas:
    Thing:
      type: object
      properties:
        pet: { $ref: 'https://example.com/schemas/pet' }
        self: { $ref: '#/components/schemas/Thing' }
`;

// Referenced document with an $id/$anchor schema resource and an internal $defs ref.
const SHARED = `
openapi: 3.1.0
$self: https://example.com/oad/shared.yaml
info: { title: Shared, version: '1.0' }
paths: {}
components:
  pathItems:
    Common:
      get:
        operationId: sharedGet
        responses: { '200': { description: ok } }
  parameters:
    SharedLimit:
      name: limit
      in: query
      schema: { type: integer }
  schemas:
    Pet:
      $id: https://example.com/schemas/pet
      $anchor: PetAnchor
      type: object
      $defs:
        Inner: { type: string }
      properties:
        inner: { $ref: '#/$defs/Inner' }
`;

let refs: ResolvedRefs;
let entryId: string;
let sharedId: string;

const PET_POINTER = "/components/schemas/Pet";

function byRef(refString: string): ReferenceEdge[] {
  return refs.edges.filter((e) => e.refString === refString);
}

beforeAll(async () => {
  const entry = await makeDoc(ENTRY, { isEntry: true, filename: "entry.yaml" });
  const shared = await makeDoc(SHARED, { filename: "shared.yaml" });
  entryId = entry.id;
  sharedId = shared.id;
  refs = resolveOad(makeOad(entry, shared));
});

describe("resolveOad — status tally", () => {
  it("classifies every reference", () => {
    const tally: Record<string, number> = {};
    for (const e of refs.edges) tally[e.status] = (tally[e.status] ?? 0) + 1;
    expect(tally).toEqual({ resolved: 7, "type-mismatch": 2, broken: 1, external: 1 });
  });
});

describe("resolveOad — resolved references", () => {
  it("resolves a Path Item $ref cross-document", () => {
    const edge = refs.edges.find((e) => e.context === "pathItem");
    expect(edge?.status).toBe("resolved");
    expect(edge?.targetDocId).toBe(sharedId);
  });

  it("resolves a Schema $ref by $anchor", () => {
    const edge = byRef("https://example.com/schemas/pet#PetAnchor")[0];
    expect(edge?.status).toBe("resolved");
    expect(edge?.targetDocId).toBe(sharedId);
    expect(edge?.targetNodeId).toBe(PET_POINTER);
  });

  it("resolves a Schema $ref by $id", () => {
    const edge = byRef("https://example.com/schemas/pet")[0];
    expect(edge?.status).toBe("resolved");
    expect(edge?.targetNodeId).toBe(PET_POINTER);
  });

  it("resolves operationRef to an Operation", () => {
    const edge = byRef("#/paths/~1links/get")[0];
    expect(edge?.kind).toBe("operationRef");
    expect(edge?.status).toBe("resolved");
    expect(edge?.requiredType).toBe("Operation");
  });

  it("resolves a $id-scoped internal pointer relative to the resource root", () => {
    const edge = byRef("#/$defs/Inner")[0];
    expect(edge?.status).toBe("resolved");
    expect(edge?.sourceDocId).toBe(sharedId);
    expect(edge?.targetNodeId).toBe("/components/schemas/Pet/$defs/Inner");
  });
});

describe("resolveOad — type mismatches", () => {
  it("flags a Parameter slot pointing at a Schema", () => {
    const edge = byRef("#/components/schemas/Thing").find((e) => e.context === "reference");
    expect(edge?.status).toBe("type-mismatch");
    expect(edge?.requiredType).toBe("Parameter");
    expect(edge?.targetType).toBe("Schema");
  });

  it("flags an operationRef pointing at a Schema", () => {
    const edge = byRef("#/components/schemas/Thing").find((e) => e.kind === "operationRef");
    expect(edge?.status).toBe("type-mismatch");
    expect(edge?.requiredType).toBe("Operation");
    expect(edge?.targetType).toBe("Schema");
  });
});

describe("resolveOad — unresolved references", () => {
  it("marks a missing fragment as broken (no target)", () => {
    const edge = byRef("#/components/parameters/Missing")[0];
    expect(edge?.status).toBe("broken");
    expect(edge?.targetNodeId).toBeUndefined();
  });

  it("marks an unloaded document as external (no target)", () => {
    const edge = byRef("https://elsewhere.example/api.yaml#/components/parameters/Foo")[0];
    expect(edge?.status).toBe("external");
    expect(edge?.targetDocId).toBeUndefined();
    expect(edge?.targetNodeId).toBeUndefined();
  });
});

describe("resolveOad — file:// base for uploaded files", () => {
  it("resolves a relative cross-document ref via the synthesized file:// base", async () => {
    const entry = await makeDoc(
      `openapi: 3.1.0
info: { title: E, version: '1' }
paths:
  /a:
    get:
      operationId: op
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: 'shared.yaml#/components/schemas/Pet' }
`,
      { isEntry: true, filename: "entry.yaml" },
    );
    const shared = await makeDoc(
      `openapi: 3.1.0
info: { title: S, version: '1' }
paths: {}
components:
  schemas:
    Pet: { type: object }
`,
      { filename: "shared.yaml" },
    );
    const result = resolveOad(makeOad(entry, shared));
    const edge = result.edges.find((e) => e.refString === "shared.yaml#/components/schemas/Pet");
    expect(edge?.status).toBe("resolved");
    expect(edge?.targetDocId).toBe(shared.id);
    expect(edge?.targetNodeId).toBe("/components/schemas/Pet");
  });

  it("resolves a subdirectory-relative ref using each file's relative path", async () => {
    const entry = await makeDoc(
      `openapi: 3.1.0
info: { title: E, version: '1' }
paths:
  /a:
    get:
      operationId: op
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: 'schemas/pet.yaml#/components/schemas/Pet' }
`,
      { isEntry: true, filename: "entry.yaml", relativePath: "oad/entry.yaml" },
    );
    const pet = await makeDoc(
      `openapi: 3.1.0
info: { title: P, version: '1' }
paths: {}
components:
  schemas:
    Pet: { type: object }
`,
      { filename: "pet.yaml", relativePath: "oad/schemas/pet.yaml" },
    );
    const result = resolveOad(makeOad(entry, pet));
    const edge = result.edges.find(
      (e) => e.refString === "schemas/pet.yaml#/components/schemas/Pet",
    );
    expect(edge?.status).toBe("resolved");
    expect(edge?.targetDocId).toBe(pet.id);
  });

  it("resolves across a folder mapped onto an http base URL", async () => {
    const entry = await makeDoc(
      `openapi: 3.1.0
info: { title: E, version: '1' }
paths:
  /a:
    get:
      operationId: op
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: 'schemas/pet.yaml#/components/schemas/Pet' }
`,
      { isEntry: true, retrievalUri: "https://example.com/api/openapi.yaml" },
    );
    const pet = await makeDoc(
      `openapi: 3.1.0
info: { title: P, version: '1' }
paths: {}
components:
  schemas:
    Pet: { type: object }
`,
      { retrievalUri: "https://example.com/api/schemas/pet.yaml" },
    );
    const result = resolveOad(makeOad(entry, pet));
    const edge = result.edges.find(
      (e) => e.refString === "schemas/pet.yaml#/components/schemas/Pet",
    );
    expect(edge?.status).toBe("resolved");
    expect(edge?.targetDocId).toBe(pet.id);
  });
});

describe("resolveOad — lookup maps", () => {
  it("indexes incoming references by target", () => {
    const incoming = refs.byTarget.get(refKey(entryId, "/components/schemas/Thing")) ?? [];
    expect(incoming).toHaveLength(3); // parameter ref + operationRef + same-doc self ref
  });

  it("indexes a reference under both its field and its object", () => {
    const anchorEdge = byRef("https://example.com/schemas/pet#PetAnchor")[0]!;
    const byObject = refs.bySource.get(refKey(anchorEdge.sourceDocId, anchorEdge.sourceObjectId)) ?? [];
    const byField = refs.bySource.get(refKey(anchorEdge.sourceDocId, anchorEdge.sourceNodeId)) ?? [];
    expect(byObject).toContain(anchorEdge);
    expect(byField).toContain(anchorEdge);
  });
});
