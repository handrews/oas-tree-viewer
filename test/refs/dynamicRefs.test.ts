import { describe, it, expect, beforeAll } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";
import { unreachableDocs } from "../../src/render/reachability";
import { makeDoc, makeOad } from "../helpers";
import type { Oad } from "../../src/types";

// Entry: a dynamic $dynamicRef (#T), a $ref that lands on a $dynamicAnchor (Case B), a $dynamicRef
// whose local fragment is a plain $anchor (Case A — stays static), and a broken $dynamicRef.
const ENTRY = `
openapi: 3.1.0
$self: https://example.com/oad/entry
info: { title: Entry, version: '1.0' }
paths: {}
components:
  schemas:
    Link2:
      $ref: 'shared#/components/schemas/Override'
    List:
      $id: https://example.com/schemas/list
      type: object
      properties:
        items: { $dynamicRef: '#T' }
      $defs:
        defaultT: { $dynamicAnchor: T, type: string }
    UsesRef:
      type: object
      properties:
        x: { $ref: 'https://example.com/schemas/list#T' }
    StaticList:
      $id: https://example.com/schemas/staticlist
      type: object
      properties:
        items: { $dynamicRef: '#A' }
      $defs:
        localA: { $anchor: A, type: number }
    BrokenList:
      $id: https://example.com/schemas/brokenlist
      type: object
      properties:
        items: { $dynamicRef: '#NOPE' }
`;

// Reachable (entry's Link2 $ref points here): another $dynamicAnchor T, plus a $dynamicAnchor A
// that must NOT capture the Case-A static $dynamicRef (its local fragment is a plain $anchor).
const SHARED = `
openapi: 3.1.0
$self: https://example.com/oad/shared
info: { title: Shared, version: '1.0' }
paths: {}
components:
  schemas:
    Override:
      $id: https://example.com/schemas/override
      $dynamicAnchor: T
      type: object
    OverrideA:
      $id: https://example.com/schemas/overridea
      $dynamicAnchor: A
      type: number
`;

// Unreachable: its $dynamicAnchor T must be excluded from the tentative fan-out (entry-reachable).
const REMOTE = `
openapi: 3.1.0
$self: https://example.com/oad/remote
info: { title: Remote, version: '1.0' }
paths: {}
components:
  schemas:
    RemoteOverride:
      $id: https://example.com/schemas/remoteoverride
      $dynamicAnchor: T
      type: object
`;

let refs: ResolvedRefs;
let oad: Oad;
let entryId: string;
let sharedId: string;
let remoteId: string;

const dynRefs = (frag: string): ReferenceEdge[] =>
  refs.edges.filter((e) => e.kind === "$dynamicRef" && e.refString === frag);

beforeAll(async () => {
  const entry = await makeDoc(ENTRY, { isEntry: true, filename: "entry.yaml" });
  const shared = await makeDoc(SHARED, { filename: "shared.yaml" });
  const remote = await makeDoc(REMOTE, { filename: "remote.yaml" });
  entryId = entry.id;
  sharedId = shared.id;
  remoteId = remote.id;
  oad = makeOad(entry, shared, remote);
  refs = resolveOad(oad);
});

describe("$dynamicRef — dynamic fan-out", () => {
  it("points tentatively at every entry-reachable $dynamicAnchor of the name", () => {
    const edges = dynRefs("#T");
    expect(edges).toHaveLength(2); // the remote $dynamicAnchor T is excluded (unreachable)
    for (const e of edges) {
      expect(e.resolution).toBe("dynamic");
      expect(e.status).toBe("resolved");
      expect(e.requiredType).toBe("Schema");
    }
    const targets = edges.map((e) => `${e.targetDocId} ${e.targetNodeId}`).sort();
    expect(targets).toEqual(
      [
        `${entryId} /components/schemas/List/$defs/defaultT`,
        `${sharedId} /components/schemas/Override`,
      ].sort(),
    );
  });

  it("excludes a $dynamicAnchor in an unreachable document", () => {
    expect(unreachableDocs(oad, refs).map((d) => d.id)).toContain(remoteId);
    expect(dynRefs("#T").some((e) => e.targetDocId === remoteId)).toBe(false);
  });
});

describe("$dynamicRef — static bookend (Case A)", () => {
  it("behaves exactly like $ref when the local fragment is a plain $anchor", () => {
    const edges = dynRefs("#A");
    expect(edges).toHaveLength(1); // no dynamic fan-out, despite a $dynamicAnchor A elsewhere
    expect(edges[0]!.resolution).toBe("uri-reference");
    expect(edges[0]!.status).toBe("resolved");
    expect(edges[0]!.targetDocId).toBe(entryId);
    expect(edges[0]!.targetNodeId).toBe("/components/schemas/StaticList/$defs/localA");
  });
});

describe("$dynamicRef — broken", () => {
  it("is broken when no anchor of the name exists locally", () => {
    const edges = dynRefs("#NOPE");
    expect(edges).toHaveLength(1);
    expect(edges[0]!.resolution).toBe("uri-reference");
    expect(edges[0]!.status).toBe("broken");
    expect(edges[0]!.targetNodeId).toBeUndefined();
  });
});

describe("$ref to a $dynamicAnchor (Case B)", () => {
  it("resolves statically, treating the $dynamicAnchor like a plain $anchor", () => {
    const edge = refs.edges.find(
      (e) => e.kind === "$ref" && e.refString === "https://example.com/schemas/list#T",
    )!;
    expect(edge.resolution).toBe("uri-reference");
    expect(edge.status).toBe("resolved");
    expect(edge.targetNodeId).toBe("/components/schemas/List/$defs/defaultT");
  });
});
