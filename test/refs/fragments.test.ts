import { describe, it, expect } from "vitest";
import { runPipeline } from "../../src/app/bootstrap";
import { defaultConfig } from "../../src/app/config";
import { makeInput } from "../helpers";
import { docVersionLabel } from "../../src/render/detail";
import type { Oad, TreeNode } from "../../src/types";
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

/** Find a node by JSON Pointer within a tree (property keys only — enough for these fixtures). */
function nodeAt(root: TreeNode, pointer: string): TreeNode | undefined {
  if (pointer === "") return root;
  let cur: TreeNode | undefined = root;
  for (const seg of pointer.split("/").slice(1)) {
    cur = cur?.children.find((c) => c.key === seg);
  }
  return cur;
}

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

describe("document fragments — interior references (any mode)", () => {
  // A shared schema library: nothing references its root, but the entry references two interior schemas
  // (#/Pet, #/Error). Only those nodes (and their descendants) take a type; the root stays generic.
  const ENTRY = `
openapi: 3.1.0
info: { title: T, version: '1.0' }
paths: {}
components:
  schemas:
    PetRef: { $ref: schema-lib.yaml#/Pet }
    ErrorRef: { $ref: schema-lib.yaml#/Error }
`;
  const LIB = `
Pet:
  type: object
  properties:
    name: { type: string }
    problem: { $ref: '#/Error' }
Error:
  type: object
  properties:
    message: { type: string }
`;

  it("types only the referenced interior nodes, leaving the root generic", async () => {
    const { oad, refs } = await ok([input(ENTRY, "openapi.yaml", true), input(LIB, "schema-lib.yaml")]);
    const lib = fragOf(oad, "schema-lib.yaml");

    expect(lib.root.oasType).toBeUndefined(); // root untyped (a generic map of schemas)
    expect(lib.fragmentInteriorTyped).toBe(true);
    expect(nodeAt(lib.root, "/Pet")?.oasType).toBe("Schema Object");
    expect(nodeAt(lib.root, "/Error")?.oasType).toBe("Schema Object");

    // The two interior references resolve, and Pet's internal #/Error ref resolves within the fragment.
    const incoming = refs.edges.filter((e) => e.targetDocId === lib.id);
    expect(incoming.length).toBeGreaterThanOrEqual(2);
    expect(incoming.every((e) => e.status === "resolved")).toBe(true);
    const internal = refs.edges.find((e) => e.sourceDocId === lib.id && e.targetNodeId === "/Error");
    expect(internal?.status).toBe("resolved");
  });

  it("is a load error under root mode (no reference to its root)", async () => {
    const result = await runPipeline([input(ENTRY, "openapi.yaml", true), input(LIB, "schema-lib.yaml")], {
      ...defaultConfig,
      fragments: "root",
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.oadError).toMatch(/no reference to its root/i);
  });
});

describe("document fragments — interior type conflicts", () => {
  it("blanks just the node two references disagree about, keeping the rest typed", async () => {
    // The entry references frag.yaml#/a once as a Path Item and once as a Schema.
    const ENTRY = `
openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /x: { $ref: frag.yaml#/a }
components:
  schemas:
    S: { $ref: frag.yaml#/a }
    T: { $ref: frag.yaml#/b }
`;
    const FRAG = `
a: { hello: world }
b: { type: string }
`;
    const { oad, refs } = await ok([input(ENTRY, "openapi.yaml", true), input(FRAG, "frag.yaml")]);
    const frag = fragOf(oad, "frag.yaml");

    expect(frag.fragmentAmbiguous).toBeFalsy(); // the root is fine — only /a is contested
    expect(frag.fragmentContested).toContain("/a");
    expect(nodeAt(frag.root, "/a")?.oasType).toBeUndefined(); // blanked to generic
    expect(nodeAt(frag.root, "/b")?.oasType).toBe("Schema Object"); // the other ref still types /b

    const intoA = refs.edges.filter((e) => e.targetDocId === frag.id && e.targetNodeId === "/a");
    expect(intoA.length).toBe(2);
    expect(intoA.every((e) => e.status === "type-mismatch")).toBe(true);
    const intoB = refs.edges.find((e) => e.targetDocId === frag.id && e.targetNodeId === "/b");
    expect(intoB?.status).toBe("resolved");
  });

  it("detects an ancestor's type implying a different type than a descendant reference", async () => {
    // /a is typed a Path Item (from /x); /a/get is then an Operation — but a Schema ref also targets it.
    const ENTRY = `
openapi: 3.1.0
info: { title: T, version: '1.0' }
paths:
  /x: { $ref: frag.yaml#/a }
components:
  schemas:
    S: { $ref: frag.yaml#/a/get }
`;
    const FRAG = `
a:
  get:
    responses:
      '200': { description: ok }
`;
    const { oad, refs } = await ok([input(ENTRY, "openapi.yaml", true), input(FRAG, "frag.yaml")]);
    const frag = fragOf(oad, "frag.yaml");

    expect(nodeAt(frag.root, "/a")?.oasType).toBe("Path Item Object"); // ancestor stays typed
    expect(frag.fragmentContested).toContain("/a/get");
    expect(nodeAt(frag.root, "/a/get")?.oasType).toBeUndefined(); // contested → generic

    const toPathItem = refs.edges.find((e) => e.targetDocId === frag.id && e.targetNodeId === "/a");
    expect(toPathItem?.status).toBe("resolved");
    const toGet = refs.edges.find((e) => e.targetDocId === frag.id && e.targetNodeId === "/a/get");
    expect(toGet?.status).toBe("type-mismatch");
  });
});

describe("document fragments — Schema-root fragment (OAS 3.0)", () => {
  // A 3.0 OAD commonly puts a Schema Object in its own file, referenced by `$ref`. It has no
  // `$id`/`$schema` (3.0 schemas don't use them), so it is a fragment — never the standalone-JSON-Schema
  // heuristic — typed from the reference as a Schema Object, shown as "Fragment · Schema Object".
  const ENTRY = `
openapi: 3.0.4
info: { title: T, version: '1.0' }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: pet-schema.yaml }
`;
  const SCHEMA = `
type: object
required: [name]
properties:
  name: { type: string }
`;

  it("types a bare-Schema fragment as a Schema Object fragment, not a JSON Schema document", async () => {
    const { oad } = await ok([input(ENTRY, "openapi.yaml", true), input(SCHEMA, "pet-schema.yaml")]);
    const frag = fragOf(oad, "pet-schema.yaml");
    expect(oad.versionFamily).toBe("3.0");
    expect(frag.kind).toBe("fragment"); // detected as a fragment, not a standalone JSON Schema document
    expect(frag.root.oasType).toBe("Schema Object");
    expect(docVersionLabel(frag)).toBe("Fragment · Schema Object");
  });
});
