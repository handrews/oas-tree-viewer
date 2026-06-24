import { describe, it, expect } from "vitest";
import { analyzeDynamicScope } from "../../src/refs/dynamicScope";
import type { AnchorRef } from "../../src/refs/dynamicScope";
import type { TreeNode } from "../../src/types";

// Minimal stand-in nodes — winners() only reads each anchor's docId + node identity.
const node = (id: string): TreeNode => ({
  id,
  key: null,
  keyKind: "root",
  valueKind: "object",
  children: [],
});
const anchor = (resourceUri: string): AnchorRef => ({
  resourceUri,
  docId: "d",
  node: node(`${resourceUri}#anchor`),
});

const winnerResources = (
  params: Parameters<typeof analyzeDynamicScope>[0],
  resourceUri: string,
  name: string,
): string[] =>
  analyzeDynamicScope(params)
    .winners(resourceUri, name)
    // node ids are `${resourceUri}#anchor`, so recover the resource for a readable assertion.
    .map((t) => t.node.id.replace(/#anchor$/, ""))
    .sort();

describe("analyzeDynamicScope — strict winners", () => {
  // ER → E → B, where E and B both declare `$dynamicAnchor item` and B holds the `$dynamicRef`.
  const shadowed: Parameters<typeof analyzeDynamicScope>[0] = {
    entryRoot: "ER",
    resourceEdges: [
      { from: "ER", to: "E" },
      { from: "E", to: "B" },
    ],
    dynamicRefs: [{ resourceUri: "B", name: "item" }],
    anchorsByName: new Map([["item", [anchor("E"), anchor("B")]]]),
  };

  it("hides a base default that every entry path shadows with an outer anchor", () => {
    // B is reached only past E, so B's own anchor is never the outermost → only E wins.
    expect(winnerResources(shadowed, "B", "item")).toEqual(["E"]);
  });

  it("reveals the base default once the entry uses the base directly", () => {
    const direct = {
      ...shadowed,
      resourceEdges: [...shadowed.resourceEdges, { from: "ER", to: "B" }],
    };
    // Now ER reaches B without first hitting E, so B is outermost-eligible too.
    expect(winnerResources(direct, "B", "item")).toEqual(["B", "E"]);
  });

  it("drops a same-named anchor that cannot reach the $dynamicRef", () => {
    const withUnrelated = {
      ...shadowed,
      resourceEdges: [...shadowed.resourceEdges, { from: "ER", to: "U" }],
      anchorsByName: new Map([["item", [anchor("E"), anchor("B"), anchor("U")]]]),
    };
    // U is outermost-eligible but has no path to B, so it can never be in scope there.
    expect(winnerResources(withUnrelated, "B", "item")).toEqual(["E"]);
  });

  it("fans out to multiple winners that each reach the ref", () => {
    const twoExt = {
      entryRoot: "ER",
      resourceEdges: [
        { from: "ER", to: "E1" },
        { from: "ER", to: "E2" },
        { from: "ER", to: "U" },
        { from: "E1", to: "B" },
        { from: "E2", to: "B" },
      ],
      dynamicRefs: [{ resourceUri: "B", name: "item" }],
      anchorsByName: new Map([["item", [anchor("E1"), anchor("E2"), anchor("B"), anchor("U")]]]),
    };
    // E1 and E2 both override and reach B; B's default is shadowed and U can't reach.
    expect(winnerResources(twoExt, "B", "item")).toEqual(["E1", "E2"]);
  });

  it("yields no winners for a $dynamicRef the entry cannot reach", () => {
    const orphan: Parameters<typeof analyzeDynamicScope>[0] = {
      entryRoot: "ER",
      resourceEdges: [{ from: "E", to: "B" }], // nothing leaves ER
      dynamicRefs: [{ resourceUri: "B", name: "item" }],
      anchorsByName: new Map([["item", [anchor("E"), anchor("B")]]]),
    };
    expect(winnerResources(orphan, "B", "item")).toEqual([]);
  });
});
