import { describe, it, expect } from "vitest";
import { runPipeline } from "../../src/app/bootstrap";
import { defaultConfig } from "../../src/app/config";
import { makeInput } from "../helpers";
import type { Oad } from "../../src/types";
import type { ResolvedRefs } from "../../src/refs/types";

// v0.5.0 phase 2+3: a document fragment (neither an OpenAPI document nor a JSON Schema document) is
// loaded only when `fragments` is "root"/"any", unvalidated; its type is inferred from the references
// that target it — its root (phase 2) or interior nodes ("any" mode, phase 3).

const FRAGMENTS = { ...defaultConfig, fragments: "any" } as const;
const BASE = "https://ex.test";

const input = (yaml: string, name: string, isEntry = false) =>
  makeInput(yaml, { filename: name, retrievalUri: `${BASE}/${name}`, isEntry });

async function ok(inputs: ReturnType<typeof input>[]): Promise<{ oad: Oad; refs: ResolvedRefs }> {
  const result = await runPipeline(inputs, FRAGMENTS);
  if (!result.ok) throw new Error(`pipeline failed: ${result.oadError ?? JSON.stringify(result.rowErrors)}`);
  return { oad: result.oad, refs: result.refs };
}

const fragOf = (oad: Oad, name: string) =>
  oad.documents.find((d) => d.kind === "fragment" && d.retrievalUri === `${BASE}/${name}`)!;

describe("document fragments — detection", () => {
  it("rejects an unrecognized document when fragments are off, loads it as a fragment when on", async () => {
    const frag = makeInput("get: { responses: { '200': { description: ok } } }\n", { isEntry: true });
    const off = await runPipeline([frag], defaultConfig);
    expect(off.ok).toBe(false);

    const entry = input("openapi: 3.1.0\ninfo: { title: T, version: '1' }\npaths:\n  /p: { $ref: f.yaml }\n", "openapi.yaml", true);
    const { oad } = await ok([entry, input("get: { responses: { '200': { description: ok } } }\n", "f.yaml")]);
    expect(oad.documents.some((d) => d.kind === "fragment")).toBe(true);
  });
});

describe("document fragments — root type inferred from a reference", () => {
  const ENTRY = `
openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /pets:
    $ref: pet-pathitem.yaml
components:
  schemas:
    Pet: { type: object, properties: { name: { type: string } } }
`;
  const PATHITEM = `
get:
  operationId: listPets
  responses:
    '200':
      description: ok
      content:
        application/json:
          schema:
            $ref: openapi.yaml#/components/schemas/Pet
`;

  it("classifies a Path Item fragment and resolves the references in and out of it", async () => {
    const { oad, refs } = await ok([
      input(ENTRY, "openapi.yaml", true),
      input(PATHITEM, "pet-pathitem.yaml"),
    ]);
    const frag = fragOf(oad, "pet-pathitem.yaml");
    expect(frag.root.oasType).toBe("Path Item Object");
    expect(frag.fragmentAmbiguous).toBeFalsy();

    // The entry's Path Item $ref resolves to the fragment root...
    const incoming = refs.edges.find((e) => e.targetDocId === frag.id && e.targetNodeId === "");
    expect(incoming?.status).toBe("resolved");
    expect(incoming?.requiredType).toBe("PathItem");
    // ...and the fragment's own schema $ref resolves back to the entry's Pet.
    const outgoing = refs.edges.find((e) => e.sourceDocId === frag.id);
    expect(outgoing?.status).toBe("resolved");
    expect(outgoing?.targetType).toBe("Schema");
  });
});

describe("document fragments — ambiguous root", () => {
  // The fragment root is referenced as a Path Item (from /pets) and as a Schema (from a Schema $ref),
  // so its type is ambiguous: both root references are type errors and a reference into it errors too.
  const ENTRY = `
openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /pets:
    $ref: frag.yaml
components:
  schemas:
    UsesFrag: { $ref: frag.yaml }
    IntoFrag: { $ref: frag.yaml#/get }
`;
  const FRAG = `
get:
  responses:
    '200': { description: ok }
`;

  it("marks the conflicting root references and a reference into it as type errors, and goes generic", async () => {
    const { oad, refs } = await ok([input(ENTRY, "openapi.yaml", true), input(FRAG, "frag.yaml")]);
    const frag = fragOf(oad, "frag.yaml");
    expect(frag.fragmentAmbiguous).toBe(true);
    expect(frag.root.oasType).toBeUndefined(); // generic

    const into = refs.edges.filter((e) => e.targetDocId === frag.id);
    expect(into.length).toBeGreaterThanOrEqual(3); // two root refs + one into /get
    expect(into.every((e) => e.status === "type-mismatch")).toBe(true);
  });
});

describe("document fragments — untyped", () => {
  it("renders a non-entry unreferenced fragment as generic (no inferred type)", async () => {
    const entry = input("openapi: 3.1.0\ninfo: { title: T, version: '1' }\npaths: {}\n", "openapi.yaml", true);
    const { oad, refs } = await ok([entry, input("get: { responses: { '200': { description: ok } } }\n", "lonely.yaml")]);
    const frag = fragOf(oad, "lonely.yaml");
    expect(frag.root.oasType).toBeUndefined();
    expect(frag.fragmentAmbiguous).toBeFalsy();
    expect(refs.edges.some((e) => e.targetDocId === frag.id)).toBe(false); // nothing reaches it
  });

  it("rejects an untyped fragment that is the entry document", async () => {
    const result = await runPipeline(
      [input("get: { responses: { '200': { description: ok } } }\n", "frag.yaml", true)],
      FRAGMENTS,
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.oadError).toMatch(/entry document is a fragment/i);
  });
});

describe("document fragments — chain", () => {
  // The entry types fragment A (Path Item); A's schema $ref then types fragment B (Schema) — only
  // reachable because the fixpoint re-resolves after A is classified.
  const ENTRY = `
openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /pets: { $ref: a.yaml }
`;
  const A = `
get:
  responses:
    '200':
      description: ok
      content:
        application/json:
          schema: { $ref: b.yaml }
`;
  const B = `
type: object
properties:
  name: { type: string }
`;

  it("types a fragment referenced only from another fragment", async () => {
    const { oad } = await ok([
      input(ENTRY, "openapi.yaml", true),
      input(A, "a.yaml"),
      input(B, "b.yaml"),
    ]);
    expect(fragOf(oad, "a.yaml").root.oasType).toBe("Path Item Object");
    expect(fragOf(oad, "b.yaml").root.oasType).toBe("Schema Object");
  });
});
