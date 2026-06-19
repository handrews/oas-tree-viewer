import { describe, it, expect } from "vitest";
import { reachableDocIds, unreachableDocs } from "../../src/render/reachability";
import type { Oad, OadDocument } from "../../src/types";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";

// reachability only reads doc ids / isEntry and edge source/target doc ids.
function doc(id: string, isEntry = false): OadDocument {
  return { id, isEntry } as OadDocument;
}
function oadOf(...docs: OadDocument[]): Oad {
  return { documents: docs, versionFamily: "3.1" };
}
function refsOf(edges: Array<Partial<ReferenceEdge>>): ResolvedRefs {
  return { edges: edges as ReferenceEdge[], bySource: new Map(), byTarget: new Map() };
}

describe("reachability", () => {
  it("entry document is always reachable", () => {
    const oad = oadOf(doc("a", true));
    expect([...reachableDocIds(oad, refsOf([]))]).toEqual(["a"]);
    expect(unreachableDocs(oad, refsOf([]))).toEqual([]);
  });

  it("follows a linear chain of located references", () => {
    const oad = oadOf(doc("a", true), doc("b"), doc("c"));
    const refs = refsOf([
      { sourceDocId: "a", targetDocId: "b" },
      { sourceDocId: "b", targetDocId: "c" },
    ]);
    expect([...reachableDocIds(oad, refs)].sort()).toEqual(["a", "b", "c"]);
    expect(unreachableDocs(oad, refs)).toEqual([]);
  });

  it("flags a document reached by nothing as unreachable", () => {
    const orphan = doc("c");
    const oad = oadOf(doc("a", true), doc("b"), orphan);
    const refs = refsOf([{ sourceDocId: "a", targetDocId: "b" }]);
    expect(unreachableDocs(oad, refs)).toEqual([orphan]);
  });

  it("external/broken edges (no targetDocId) do not propagate reachability", () => {
    const oad = oadOf(doc("a", true), doc("b"));
    const refs = refsOf([{ sourceDocId: "a" }]); // external: no targetDocId
    expect([...reachableDocIds(oad, refs)]).toEqual(["a"]);
    expect(unreachableDocs(oad, refs).map((d) => d.id)).toEqual(["b"]);
  });

  it("does not count edges that start from an unreachable document", () => {
    const oad = oadOf(doc("a", true), doc("b"), doc("c"));
    // b -> c exists, but nothing reaches b, so neither b nor c is reachable.
    const refs = refsOf([{ sourceDocId: "b", targetDocId: "c" }]);
    expect([...reachableDocIds(oad, refs)]).toEqual(["a"]);
    expect(unreachableDocs(oad, refs).map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("falls back to the first document when none is marked entry", () => {
    const oad = oadOf(doc("a"), doc("b"));
    const refs = refsOf([{ sourceDocId: "a", targetDocId: "b" }]);
    expect([...reachableDocIds(oad, refs)].sort()).toEqual(["a", "b"]);
  });
});
