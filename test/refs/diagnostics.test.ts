import { describe, it, expect, beforeAll } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";
import { makeDoc, makeOad } from "../helpers";

// One entry document whose Links operationRef into every habitat: a normal path (clean), a
// webhook, a callback, and Components Path Items reached from the Paths Object by 2 / 1 / 0 paths.
// It also has a Path Item `$ref` whose `summary` sibling collides with the target's `summary`.
const ENTRY = `
openapi: 3.2.0
$self: https://example.com/oad/ops
info: { title: Ops, version: '1.0' }
paths:
  /main:
    get:
      operationId: mainGet
      responses:
        '200':
          description: ok
          links:
            clean: { operationRef: '#/paths/~1main/get' }
            toWebhook: { operationRef: '#/webhooks/hook/get' }
            toCallback: { operationRef: '#/paths/~1main/get/callbacks/onEvent/cbUrl/post' }
            toAmbiguous: { operationRef: '#/components/pathItems/Shared2/get' }
            toFragile: { operationRef: '#/components/pathItems/Shared1/get' }
            toOrphan: { operationRef: '#/components/pathItems/Orphan/get' }
      callbacks:
        onEvent:
          cbUrl:
            post:
              operationId: cbPost
              responses: { '200': { description: ok } }
  /a: { $ref: '#/components/pathItems/Shared1' }
  /b: { $ref: '#/components/pathItems/Shared2' }
  /c: { $ref: '#/components/pathItems/Shared2' }
  /overlap:
    summary: inline summary
    $ref: '#/components/pathItems/Target'
webhooks:
  hook:
    get:
      operationId: hookGet
      responses: { '200': { description: ok } }
components:
  pathItems:
    Shared1:
      get: { operationId: s1get, responses: { '200': { description: ok } } }
    Shared2:
      get: { operationId: s2get, responses: { '200': { description: ok } } }
    Orphan:
      get: { operationId: orphanGet, responses: { '200': { description: ok } } }
    Target:
      summary: target summary
      get: { operationId: targetGet, responses: { '200': { description: ok } } }
`;

describe("operation-reference diagnostics", () => {
  let refs: ResolvedRefs;

  beforeAll(async () => {
    const doc = await makeDoc(ENTRY, { filename: "ops.yaml", isEntry: true });
    refs = resolveOad(makeOad(doc));
  });

  const edge = (refString: string): ReferenceEdge | undefined =>
    refs.edges.find((e) => e.refString === refString);
  const diags = (refString: string): ReferenceEdge["diagnostics"] => edge(refString)?.diagnostics;
  const codes = (refString: string): string[] => (diags(refString) ?? []).map((d) => d.code);

  it("leaves an operationRef to a normal Paths-Object Operation clean", () => {
    expect(diags("#/paths/~1main/get") ?? []).toHaveLength(0);
  });

  it("flags an operationRef into a webhook as an error", () => {
    expect(codes("#/webhooks/hook/get")).toEqual(["operation-target-webhook"]);
    expect(diags("#/webhooks/hook/get")?.[0]?.severity).toBe("error");
  });

  it("flags an operationRef into a callback as an error", () => {
    expect(codes("#/paths/~1main/get/callbacks/onEvent/cbUrl/post")).toEqual([
      "operation-target-callback",
    ]);
  });

  it("flags an operationRef into a component reached by 2 paths as ambiguous (error)", () => {
    expect(codes("#/components/pathItems/Shared2/get")).toEqual(["operation-target-ambiguous"]);
    const d = diags("#/components/pathItems/Shared2/get")?.[0];
    expect(d?.severity).toBe("error");
    expect(d?.detail).toContain("2");
  });

  it("flags an operationRef into a component reached by 1 path as fragile (warning)", () => {
    expect(codes("#/components/pathItems/Shared1/get")).toEqual(["operation-target-fragile"]);
    expect(diags("#/components/pathItems/Shared1/get")?.[0]?.severity).toBe("warning");
  });

  it("flags an operationRef into a component reached by 0 paths as no-path (error)", () => {
    expect(codes("#/components/pathItems/Orphan/get")).toEqual(["operation-target-no-path"]);
    expect(diags("#/components/pathItems/Orphan/get")?.[0]?.severity).toBe("error");
  });

  it("flags a Path Item $ref whose field also appears in the target (undefined merge)", () => {
    expect(codes("#/components/pathItems/Target")).toContain("pathitem-field-overlap");
    expect(diags("#/components/pathItems/Target")?.[0]?.detail).toContain("summary");
  });

  it("does not flag a Path Item $ref with no colliding fields", () => {
    expect(diags("#/components/pathItems/Shared1") ?? []).toHaveLength(0);
  });
});

// A path → component → component chain: the deepest component is reached transitively by one path.
const CHAIN = `
openapi: 3.2.0
$self: https://example.com/oad/chain
info: { title: Chain, version: '1.0' }
paths:
  /entry: { $ref: '#/components/pathItems/A' }
  /other:
    get:
      operationId: og
      responses:
        '200':
          description: ok
          links:
            toB: { operationRef: '#/components/pathItems/B/get' }
components:
  pathItems:
    A: { $ref: '#/components/pathItems/B' }
    B:
      get: { operationId: bg, responses: { '200': { description: ok } } }
`;

describe("component reachability follows $ref chains", () => {
  it("counts a component reached only transitively (path → A → B) as one path → fragile", async () => {
    const doc = await makeDoc(CHAIN, { filename: "chain.yaml", isEntry: true });
    const refs = resolveOad(makeOad(doc));
    const toB = refs.edges.find((e) => e.refString === "#/components/pathItems/B/get");
    expect((toB?.diagnostics ?? []).map((d) => d.code)).toEqual(["operation-target-fragile"]);
  });
});

// 3.2 `additionalOperations`: an Operation in that map still inherits its Path Item's habitat.
const ADDL = `
openapi: 3.2.0
$self: https://example.com/oad/addl
info: { title: Addl, version: '1.0' }
paths:
  /solo: { $ref: '#/components/pathItems/P' }
  /other:
    get:
      operationId: og
      responses:
        '200':
          description: ok
          links:
            toQuery:
              operationRef: '#/components/pathItems/P/additionalOperations/QUERY'
components:
  pathItems:
    P:
      additionalOperations:
        QUERY:
          operationId: pq
          responses: { '200': { description: ok } }
`;

describe("additionalOperations Operations inherit the Path Item habitat", () => {
  it("flags an operationRef to an additionalOperations Operation in a component reached once", async () => {
    const doc = await makeDoc(ADDL, { filename: "addl.yaml", isEntry: true });
    const refs = resolveOad(makeOad(doc));
    const e = refs.edges.find(
      (x) => x.refString === "#/components/pathItems/P/additionalOperations/QUERY",
    );
    expect((e?.diagnostics ?? []).map((d) => d.code)).toEqual(["operation-target-fragile"]);
  });
});
