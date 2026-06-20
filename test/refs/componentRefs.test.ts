import { describe, it, expect } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import type { ReferenceEdge, ResolvedRefs, RefKind } from "../../src/refs/types";
import { makeDoc, makeOad } from "../helpers";

/** Find the single edge for a given ref string (optionally narrowed by kind). */
function edge(refs: ResolvedRefs, refString: string, kind?: RefKind): ReferenceEdge {
  const found = refs.edges.find((e) => e.refString === refString && (!kind || e.kind === kind));
  if (!found) throw new Error(`no edge for ${refString}${kind ? ` (${kind})` : ""}`);
  return found;
}

describe("discriminator mapping resolution", () => {
  // A Schema with a discriminator whose mapping values exercise name vs URI vs unresolvable.
  const DOC = `
openapi: 3.1.0
$self: https://example.com/oad/entry
info: { title: T, version: '1' }
paths: {}
components:
  schemas:
    Pet:
      oneOf:
        - $ref: '#/components/schemas/Cat'
        - $ref: '#/components/schemas/Dog'
      discriminator:
        propertyName: kind
        mapping:
          c: Cat
          d: '#/components/schemas/Dog'
          x: Nope
    Cat: { type: object }
    Dog: { type: object }
`;

  it("name-first (default): bare name -> component-name; pointer -> uri; unknown -> external uri", async () => {
    const refs = resolveOad(makeOad(await makeDoc(DOC, { isEntry: true })));
    expect(edge(refs, "Cat", "discriminatorMapping")).toMatchObject({
      resolution: "component-name",
      status: "resolved",
      targetType: "Schema",
    });
    expect(edge(refs, "#/components/schemas/Dog", "discriminatorMapping")).toMatchObject({
      resolution: "uri-reference",
      status: "resolved",
    });
    expect(edge(refs, "Nope", "discriminatorMapping")).toMatchObject({
      resolution: "uri-reference",
      status: "external",
    });
  });

  it("uri-first config: a locatable URI wins; a name-only value still falls back to the component", async () => {
    const refs = resolveOad(makeOad(await makeDoc(DOC, { isEntry: true })), {
      mappingPrecedence: "uri-first",
      componentLookup: "entry",
    });
    // "#/components/schemas/Dog" locates a target as a URI -> stays a URI-reference.
    expect(edge(refs, "#/components/schemas/Dog", "discriminatorMapping")).toMatchObject({
      resolution: "uri-reference",
      status: "resolved",
    });
    // "Cat" can't be located as a URI, so it falls back to the component name.
    expect(edge(refs, "Cat", "discriminatorMapping")).toMatchObject({
      resolution: "component-name",
      status: "resolved",
    });
  });

  it("annotates the source node with how it resolved (drives the marker)", async () => {
    const oad = makeOad(await makeDoc(DOC, { isEntry: true }));
    resolveOad(oad);
    const mapping = findByPointer(oad.documents[0]!.root, "/components/schemas/Pet/discriminator/mapping");
    const byName = mapping!.children.find((c) => c.key === "c")!;
    const byUri = mapping!.children.find((c) => c.key === "d")!;
    expect(byName.resolvedAs).toBe("component-name");
    expect(byUri.resolvedAs).toBe("uri-reference");
  });
});

describe("security requirement resolution", () => {
  const base = (version: string) => `
openapi: ${version}
$self: https://example.com/oad/entry
info: { title: T, version: '1' }
paths: {}
security:
  - apiKey: []
  - elsewhere: []
components:
  securitySchemes:
    apiKey: { type: apiKey, name: X, in: header }
`;

  it("3.1: a key is always a component name (match -> resolved, no match -> broken)", async () => {
    const refs = resolveOad(makeOad(await makeDoc(base("3.1.0"), { isEntry: true })));
    expect(edge(refs, "apiKey", "securityRequirement")).toMatchObject({
      resolution: "component-name",
      status: "resolved",
      targetType: "SecurityScheme",
    });
    expect(edge(refs, "elsewhere", "securityRequirement")).toMatchObject({
      resolution: "component-name",
      status: "broken",
    });
  });

  it("3.2: a non-matching key becomes a URI-reference", async () => {
    const refs = resolveOad(makeOad(await makeDoc(base("3.2.0"), { isEntry: true })));
    expect(edge(refs, "apiKey", "securityRequirement")).toMatchObject({
      resolution: "component-name",
      status: "resolved",
    });
    expect(edge(refs, "elsewhere", "securityRequirement")).toMatchObject({
      resolution: "uri-reference",
      status: "external",
    });
  });
});

describe("entry-vs-local component lookup", () => {
  // The entry declares apiKey; a second document references it but has no local component.
  const ENTRY = `
openapi: 3.1.0
$self: https://example.com/oad/entry
info: { title: Entry, version: '1' }
paths:
  /a: { $ref: 'other#/components/pathItems/P' }
components:
  securitySchemes:
    apiKey: { type: apiKey, name: X, in: header }
`;
  const OTHER = `
openapi: 3.1.0
$self: https://example.com/oad/other
info: { title: Other, version: '1' }
paths: {}
components:
  pathItems:
    P:
      get:
        operationId: op
        security:
          - apiKey: []
        responses: { '200': { description: ok } }
`;

  it("default looks in the entry document; the local-document option does not find it", async () => {
    const entry = await makeDoc(ENTRY, { isEntry: true });
    const other = await makeDoc(OTHER);
    const oad = makeOad(entry, other);

    const entryLookup = resolveOad(oad); // default: entry
    expect(edge(entryLookup, "apiKey", "securityRequirement")).toMatchObject({
      resolution: "component-name",
      status: "resolved",
      targetDocId: entry.id,
    });

    const localLookup = resolveOad(oad, { mappingPrecedence: "name-first", componentLookup: "local" });
    // Not in the local (other) document, and 3.1 has no URI fallback -> broken.
    expect(edge(localLookup, "apiKey", "securityRequirement")).toMatchObject({
      resolution: "component-name",
      status: "broken",
    });
  });
});

// Tiny pointer-walk helper (node ids are doc-root JSON Pointers).
function findByPointer(root: { id: string; children: unknown[] }, pointer: string): {
  key: string | null;
  children: { key: string | null; resolvedAs?: string }[];
} | null {
  const stack = [root as { id: string; children: { id: string; children: unknown[] }[] }];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === pointer) return n as never;
    for (const c of n.children) stack.push(c as never);
  }
  return null;
}
