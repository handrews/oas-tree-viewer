import { describe, it, expect } from "vitest";
import { collectIssues, formatIssueReport } from "../../src/render/issues";
import type { Oad, OadDocument } from "../../src/types";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";

function doc(id: string, filename: string, isEntry = false): OadDocument {
  return { id, filename, isEntry, source: "upload" } as OadDocument;
}
function refsOf(edges: Array<Partial<ReferenceEdge>>): ResolvedRefs {
  return { edges: edges as ReferenceEdge[], bySource: new Map(), byTarget: new Map() };
}

const entry = doc("a", "openapi.yaml", true);
const other = doc("b", "common.yaml");
const oad: Oad = { documents: [entry, other], versionFamily: "3.1" };

describe("issues", () => {
  it("excludes resolved edges and reports nothing when clean", () => {
    const refs = refsOf([
      { status: "resolved", sourceDocId: "a", sourceObjectId: "/x", refString: "#/y", requiredType: "Schema" },
    ]);
    const report = collectIssues(oad, refs, []);
    expect(report.total).toBe(0);
    expect(report.refIssues).toEqual([]);
    const text = formatIssueReport(report);
    expect(text).toContain("No issues found.");
    expect(text).toContain("Entry document: openapi.yaml");
  });

  it("collects broken, external, and type-mismatch references with details", () => {
    const refs = refsOf([
      { status: "broken", sourceDocId: "a", sourceObjectId: "/paths/p", refString: "#/missing", requiredType: "Response" },
      { status: "external", sourceDocId: "a", sourceObjectId: "/c", refString: "ext.yaml#/X", requiredType: "Schema" },
      { status: "type-mismatch", sourceDocId: "b", sourceObjectId: "/d", refString: "#/e", requiredType: "Operation", targetType: "Schema" },
    ]);
    const report = collectIssues(oad, refs, []);
    expect(report.refIssues).toHaveLength(3);

    const broken = report.refIssues.find((i) => i.status === "broken")!;
    expect(broken.severity).toBe("error");
    expect(broken.sourceDoc).toBe("openapi.yaml");
    expect(broken.sourcePointer).toBe("#/paths/p");
    expect(broken.detail).toMatch(/not found/);

    const external = report.refIssues.find((i) => i.status === "external")!;
    expect(external.severity).toBe("warning");
    expect(external.detail).toMatch(/not loaded/);

    const mismatch = report.refIssues.find((i) => i.status === "type-mismatch")!;
    expect(mismatch.detail).toBe("expected Operation, found Schema");
  });

  it("collects unreachable documents as warnings", () => {
    const report = collectIssues(oad, refsOf([]), [other]);
    expect(report.docIssues).toEqual([
      { severity: "warning", doc: "common.yaml", detail: "not reachable from the entry document" },
    ]);
    expect(report.total).toBe(1);
  });

  it("formats a self-describing plain-text report (root pointer renders as #)", () => {
    const refs = refsOf([
      { status: "broken", sourceDocId: "a", sourceObjectId: "", refString: "#/missing", requiredType: "Schema" },
    ]);
    const text = formatIssueReport(collectIssues(oad, refs, [other]));
    expect(text).toContain("OAS Structure Viewer — issue report");
    expect(text).toContain("Unresolved references (1):");
    expect(text).toContain("[broken] openapi.yaml #");
    expect(text).toContain("$ref: #/missing");
    expect(text).toContain("Unreachable documents (1):");
    expect(text).toContain("common.yaml — not reachable from the entry document");
  });
});
