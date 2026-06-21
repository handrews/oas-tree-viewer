import { describe, it, expect, beforeAll } from "vitest";
import { resolveOad } from "../../src/refs/resolver";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";
import { unreachableDocs } from "../../src/render/reachability";
import { makeDoc, makeOad } from "../helpers";
import type { Oad } from "../../src/types";

// Strict-winner $dynamicRef resolution: a dynamic `$dynamicRef "#item"` points only at the
// `$dynamicAnchor`s that could actually be the runtime resolution — the outermost same-named anchor
// on an entry-rooted evaluation path that reaches the ref.
//
// Entry validates against StrictList (entry) and LooseList (shared), each of which declares
// `$dynamicAnchor item` and `allOf: [$ref GenericList]`, and against Unrelated (declares
// `$dynamicAnchor item` but never references GenericList). GenericList is the base: it holds the
// default `$dynamicAnchor item` and the `$dynamicRef "#item"`. It is only ever reached *via* an
// overriding extension, so its own default is shadowed.
const ENTRY = `
openapi: 3.1.0
$self: https://example.com/oad/entry
info: { title: Entry, version: '1.0' }
paths:
  /strict:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/StrictList' }
  /loose:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: 'shared#/components/schemas/LooseList' }
  /unrelated:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Unrelated' }
components:
  schemas:
    GenericList:
      $id: https://example.com/schemas/genericlist
      type: object
      properties:
        item: { $dynamicRef: '#item' }
      $defs:
        defaultItem: { $dynamicAnchor: item, type: string }
    StrictList:
      $id: https://example.com/schemas/strictlist
      $dynamicAnchor: item
      allOf:
        - $ref: 'https://example.com/schemas/genericlist'
    Unrelated:
      $id: https://example.com/schemas/unrelated
      $dynamicAnchor: item
      type: object
    # Case B: a plain $ref that lands on a $dynamicAnchor — resolved statically, like $anchor.
    DirectRef:
      type: object
      properties:
        x: { $ref: 'https://example.com/schemas/genericlist#item' }
    # Case A: a $dynamicRef whose local fragment is a plain $anchor — behaves exactly like $ref,
    # despite the $dynamicAnchor "leaf" in the shared document.
    FixedList:
      $id: https://example.com/schemas/fixedlist
      type: object
      properties:
        item: { $dynamicRef: '#leaf' }
      $defs:
        localLeaf: { $anchor: leaf, type: string }
    # No anchor of this name exists locally → broken.
    BrokenList:
      $id: https://example.com/schemas/brokenlist
      type: object
      properties:
        item: { $dynamicRef: '#nope' }
    # A dynamic $dynamicRef in a schema nothing references → unreachable → no tentative targets.
    OrphanList:
      $id: https://example.com/schemas/orphanlist
      $dynamicAnchor: orphan
      type: object
      properties:
        item: { $dynamicRef: '#orphan' }
`;

// Reachable via the /loose path. LooseList overrides + reaches GenericList → a cross-doc winner.
// LeafOverride's $dynamicAnchor "leaf" must NOT capture FixedList (Case A stays static).
const SHARED = `
openapi: 3.1.0
$self: https://example.com/oad/shared
info: { title: Shared, version: '1.0' }
paths: {}
components:
  schemas:
    LooseList:
      $id: https://example.com/schemas/looselist
      $dynamicAnchor: item
      allOf:
        - $ref: 'https://example.com/schemas/genericlist'
    LeafOverride:
      $id: https://example.com/schemas/leafoverride
      $dynamicAnchor: leaf
      type: number
`;

// Unreachable: its $dynamicAnchor item is never in any entry-rooted scope → excluded.
const REMOTE = `
openapi: 3.1.0
$self: https://example.com/oad/remote
info: { title: Remote, version: '1.0' }
paths: {}
components:
  schemas:
    RemoteList:
      $id: https://example.com/schemas/remotelist
      $dynamicAnchor: item
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

describe("$dynamicRef — strict-winner fan-out", () => {
  it("points only at the anchors that can be the outermost on an entry-rooted path", () => {
    const edges = dynRefs("#item");
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.resolution).toBe("dynamic");
      expect(e.status).toBe("resolved");
      expect(e.requiredType).toBe("Schema");
    }
    const targets = edges.map((e) => `${e.targetDocId} ${e.targetNodeId}`).sort();
    expect(targets).toEqual(
      [
        `${entryId} /components/schemas/StrictList`,
        `${sharedId} /components/schemas/LooseList`,
      ].sort(),
    );
  });

  it("hides the base's own default (always shadowed by an overriding extension)", () => {
    const targets = dynRefs("#item").map((e) => e.targetNodeId);
    expect(targets).not.toContain("/components/schemas/GenericList/$defs/defaultItem");
  });

  it("drops a same-named anchor that cannot reach the $dynamicRef (Unrelated)", () => {
    const targets = dynRefs("#item").map((e) => e.targetNodeId);
    expect(targets).not.toContain("/components/schemas/Unrelated");
  });

  it("drops a $dynamicAnchor in an unreachable document", () => {
    expect(unreachableDocs(oad, refs).map((d) => d.id)).toContain(remoteId);
    expect(dynRefs("#item").some((e) => e.targetDocId === remoteId)).toBe(false);
  });
});

describe("$dynamicRef — unreachable ref", () => {
  it("draws no tentative targets when the entry never reaches the ref", () => {
    const edges = dynRefs("#orphan");
    expect(edges).toHaveLength(0);
  });
});

describe("$dynamicRef — static bookend (Case A)", () => {
  it("behaves exactly like $ref when the local fragment is a plain $anchor", () => {
    const edges = dynRefs("#leaf");
    expect(edges).toHaveLength(1); // no dynamic fan-out, despite a $dynamicAnchor leaf elsewhere
    expect(edges[0]!.resolution).toBe("uri-reference");
    expect(edges[0]!.status).toBe("resolved");
    expect(edges[0]!.targetDocId).toBe(entryId);
    expect(edges[0]!.targetNodeId).toBe("/components/schemas/FixedList/$defs/localLeaf");
  });
});

describe("$dynamicRef — broken", () => {
  it("is broken when no anchor of the name exists locally", () => {
    const edges = dynRefs("#nope");
    expect(edges).toHaveLength(1);
    expect(edges[0]!.resolution).toBe("uri-reference");
    expect(edges[0]!.status).toBe("broken");
    expect(edges[0]!.targetNodeId).toBeUndefined();
  });
});

describe("$ref to a $dynamicAnchor (Case B)", () => {
  it("resolves statically, treating the $dynamicAnchor like a plain $anchor", () => {
    const edge = refs.edges.find(
      (e) => e.kind === "$ref" && e.refString === "https://example.com/schemas/genericlist#item",
    )!;
    expect(edge.resolution).toBe("uri-reference");
    expect(edge.status).toBe("resolved");
    expect(edge.targetNodeId).toBe("/components/schemas/GenericList/$defs/defaultItem");
  });
});

// When the entry validates against the base directly (not only via an overriding extension), the
// base's own default becomes a legitimate runtime resolution and reappears among the winners.
describe("$dynamicRef — default reappears on direct use", () => {
  const ENTRY2 = `
openapi: 3.1.0
$self: https://example.com/oad/e2
info: { title: E2, version: '1.0' }
paths:
  /base:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/GenericList' }
  /strict:
    get:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/StrictList' }
components:
  schemas:
    GenericList:
      $id: https://example.com/g
      type: object
      properties:
        item: { $dynamicRef: '#item' }
      $defs:
        defaultItem: { $dynamicAnchor: item, type: string }
    StrictList:
      $id: https://example.com/s
      $dynamicAnchor: item
      allOf:
        - $ref: 'https://example.com/g'
`;

  it("includes the base default alongside the extension", async () => {
    const entry = await makeDoc(ENTRY2, { isEntry: true, filename: "e2.yaml" });
    const oad2 = makeOad(entry);
    const refs2 = resolveOad(oad2);
    const edges = refs2.edges.filter((e) => e.kind === "$dynamicRef" && e.refString === "#item");
    expect(edges).toHaveLength(2);
    const targets = edges.map((e) => e.targetNodeId).sort();
    expect(targets).toEqual(
      ["/components/schemas/GenericList/$defs/defaultItem", "/components/schemas/StrictList"].sort(),
    );
  });
});
