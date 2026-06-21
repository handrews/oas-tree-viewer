import { describe, it, expect, beforeAll } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";
import type { DiagnosticCode } from "../../src/refs/types";
import { unreachableDocs } from "../../src/render/reachability";
import { makeDoc, makeOad } from "../helpers";
import type { Oad } from "../../src/types";

// Entry document: a Link per operationId outcome — a unique match, a missing match, a match in a
// remote document reachable only by operationId, and resolved targets that aren't cleanly callable
// (webhook, callback, and Components Path Items reached by 2 / 1 / 0 paths).
const ENTRY = `
openapi: 3.2.0
$self: https://example.com/oad/entry
info: { title: Entry, version: '1.0' }
paths:
  /a:
    get:
      operationId: getA
      responses:
        '200':
          description: OK
          links:
            self: { operationId: getPet }
            missing: { operationId: noSuchOp }
            remote: { operationId: remoteOp }
            toWebhook: { operationId: hookOp }
            toCallback: { operationId: cbOp }
            ambiguousUrl: { operationId: comp2Op }
            fragile: { operationId: comp1Op }
            noPath: { operationId: comp0Op }
      callbacks:
        onEvent:
          cbUrl:
            post:
              operationId: cbOp
              responses: { '200': { description: OK } }
  /pet:
    get:
      operationId: getPet
      responses: { '200': { description: OK } }
  /two-a: { $ref: '#/components/pathItems/Comp2' }
  /two-b: { $ref: '#/components/pathItems/Comp2' }
  /one: { $ref: '#/components/pathItems/Comp1' }
webhooks:
  petEvent:
    get:
      operationId: hookOp
      responses: { '200': { description: OK } }
components:
  pathItems:
    Comp2: { get: { operationId: comp2Op, responses: { '200': { description: OK } } } }
    Comp1: { get: { operationId: comp1Op, responses: { '200': { description: OK } } } }
    Comp0: { get: { operationId: comp0Op, responses: { '200': { description: OK } } } }
`;

// A second document reachable ONLY via the `remote` Link's operationId.
const REMOTE = `
openapi: 3.2.0
$self: https://example.com/oad/remote
info: { title: Remote, version: '1.0' }
paths:
  /remote:
    get:
      operationId: remoteOp
      responses: { '200': { description: OK } }
`;

let refs: ResolvedRefs;
let oad: Oad;
let entryId: string;
let remoteId: string;

/** The single operationId edge whose operationId (refString) is `id`. */
function opEdge(id: string): ReferenceEdge | undefined {
  return refs.edges.find((e) => e.kind === "operationId" && e.refString === id);
}

function codes(id: string): DiagnosticCode[] {
  return (opEdge(id)?.diagnostics ?? []).map((d) => d.code);
}

beforeAll(async () => {
  const entry = await makeDoc(ENTRY, { isEntry: true, filename: "entry.yaml" });
  const remote = await makeDoc(REMOTE, { filename: "remote.yaml" });
  entryId = entry.id;
  remoteId = remote.id;
  oad = makeOad(entry, remote);
  refs = resolveOad(oad);
});

describe("operationId resolution", () => {
  it("draws every operationId Link as an implicit operation-id connection", () => {
    const opEdges = refs.edges.filter((e) => e.kind === "operationId");
    expect(opEdges).toHaveLength(8);
    for (const e of opEdges) {
      expect(e.resolution).toBe("operation-id");
      expect(e.requiredType).toBe("Operation");
      expect(e.context).toBe("link");
    }
  });

  it("resolves a unique operationId to its Operation", () => {
    const e = opEdge("getPet")!;
    expect(e.status).toBe("resolved");
    expect(e.targetDocId).toBe(entryId);
    expect(e.targetNodeId).toBe("/paths/~1pet/get");
  });

  it("marks an operationId that matches no Operation as broken", () => {
    const e = opEdge("noSuchOp")!;
    expect(e.status).toBe("broken");
    expect(e.targetDocId).toBeUndefined();
    expect(e.targetNodeId).toBeUndefined();
  });

  it("resolves an operationId into another loaded document", () => {
    const e = opEdge("remoteOp")!;
    expect(e.status).toBe("resolved");
    expect(e.targetDocId).toBe(remoteId);
  });
});

describe("operationId callability advisories (shared with operationRef)", () => {
  it("flags a webhook target", () => {
    expect(codes("hookOp")).toContain("operation-target-webhook");
  });
  it("flags a callback target", () => {
    expect(codes("cbOp")).toContain("operation-target-callback");
  });
  it("flags a Components Path Item reached by 2 / 1 / 0 paths", () => {
    expect(codes("comp2Op")).toContain("operation-target-ambiguous");
    expect(codes("comp1Op")).toContain("operation-target-fragile");
    expect(codes("comp0Op")).toContain("operation-target-no-path");
  });
});

describe("operationId does not make a document reachable", () => {
  it("keeps a document reached only by operationId flagged unreachable", () => {
    const unreachable = unreachableDocs(oad, refs).map((d) => d.id);
    expect(unreachable).toContain(remoteId);
  });
});
