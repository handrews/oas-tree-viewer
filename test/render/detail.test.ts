import { describe, it, expect, beforeEach } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import {
  docName,
  baseUri,
  docVersionLabel,
  formatScalar,
  outgoingRefs,
  incomingRefs,
} from "../../src/render/detail";
import type { OadDocument, TreeNode } from "../../src/types";
import { makeDoc, makeOad } from "../helpers";

const DOC = `
openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /a:
    get:
      operationId: op
      parameters:
        - $ref: '#/components/schemas/S'
        - $ref: https://other.example/x.yaml#/components/parameters/P
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/S' }
components:
  schemas:
    S: { type: object }
`;

describe("docVersionLabel", () => {
  it("shows the OAS version for an OpenAPI document and the dialect for a schema document", async () => {
    const openapi = await makeDoc(DOC, { isEntry: true });
    expect(docVersionLabel(openapi)).toBe("OAS 3.1.0");

    const schema = await makeDoc(
      "$schema: https://json-schema.org/draft/2020-12/schema\ntype: object\n",
      { isEntry: true },
    );
    expect(docVersionLabel(schema)).toBe("JSON Schema 2020-12");
  });

  it("labels a fragment by its inferred root type, or ambiguous / partial / undetermined", () => {
    const frag = (
      root: { oasType?: string },
      extra: { fragmentAmbiguous?: boolean; fragmentInteriorTyped?: boolean } = {},
    ): OadDocument => ({ kind: "fragment", root, ...extra }) as unknown as OadDocument;
    expect(docVersionLabel(frag({ oasType: "Path Item Object" }))).toBe(
      "Fragment · Path Item Object",
    );
    expect(docVersionLabel(frag({}, { fragmentAmbiguous: true }))).toBe(
      "Fragment · ambiguous root",
    );
    expect(docVersionLabel(frag({}, { fragmentInteriorTyped: true }))).toBe(
      "Fragment · partially typed",
    );
    expect(docVersionLabel(frag({}))).toBe("Fragment · type undetermined");
  });
});

function at(root: TreeNode, pointer: string): TreeNode {
  const find = (n: TreeNode): TreeNode | undefined => {
    if (n.id === pointer) return n;
    for (const c of n.children) {
      const r = find(c);
      if (r) return r;
    }
    return undefined;
  };
  return find(root)!;
}

describe("detail field helpers", () => {
  it("docName prefers filename, then retrievalUri, then a source fallback", () => {
    expect(docName({ filename: "f.yaml" } as OadDocument)).toBe("f.yaml");
    expect(docName({ retrievalUri: "https://x/y" } as OadDocument)).toBe("https://x/y");
    expect(docName({ source: "url" } as OadDocument)).toBe("(url document)");
  });

  it("baseUri prefers $self over the retrieval URI", () => {
    expect(baseUri({ selfUri: "s", retrievalUri: "r" } as OadDocument)).toBe("s");
    expect(baseUri({ retrievalUri: "r" } as OadDocument)).toBe("r");
    expect(baseUri({} as OadDocument)).toBeUndefined();
  });

  it("formatScalar stringifies non-strings", () => {
    expect(formatScalar("x")).toBe("x");
    expect(formatScalar(3)).toBe("3");
    expect(formatScalar(true)).toBe("true");
    expect(formatScalar(null)).toBe("null");
  });
});

describe("outgoing / incoming reference selection", () => {
  let doc: OadDocument;

  beforeEach(async () => {
    doc = await makeDoc(DOC, { isEntry: true });
  });

  it("lists incoming edges (with statuses) for a referenced node", () => {
    const refs = resolveOad(makeOad(doc));
    const S = at(doc.root, "/components/schemas/S");
    const incoming = incomingRefs(refs, doc.id, S.id);
    expect(incoming.map((e) => e.status).sort()).toEqual(["resolved", "type-mismatch"]);
  });

  it("lists the outgoing edge for a reference source", () => {
    const refs = resolveOad(makeOad(doc));
    const param0 = at(doc.root, "/paths/~1a/get/parameters/0");
    const out = outgoingRefs(refs, doc.id, param0.id);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe("type-mismatch");
  });
});
