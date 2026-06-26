import { describe, it, expect } from "vitest";
import { collectIssues, formatIssueReport, issueSections } from "../../src/render/issues";
import type { Oad, OadDocument, TreeNode } from "../../src/types";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";

function doc(id: string, filename: string, isEntry = false): OadDocument {
  return { id, filename, isEntry, source: "upload" } as OadDocument;
}
function node(id: string, partial: Partial<TreeNode> = {}): TreeNode {
  return { id, key: null, keyKind: "property", valueKind: "object", children: [], ...partial };
}
function refsOf(edges: Array<Partial<ReferenceEdge>>): ResolvedRefs {
  return { edges: edges as ReferenceEdge[], bySource: new Map(), byTarget: new Map() };
}

const entry = doc("a", "openapi.yaml", true);
const other = doc("b", "common.yaml");
const oad: Oad = { documents: [entry, other], versionFamily: "3.1" };

/** The item rows under a given section id (or []), for a collected report. */
const section = (report: ReturnType<typeof collectIssues>, id: string) =>
  issueSections(report).find((s) => s.id === id)?.items ?? [];

describe("issues report", () => {
  it("reports nothing when clean", () => {
    const report = collectIssues(
      oad,
      refsOf([
        {
          status: "resolved",
          kind: "$ref",
          sourceDocId: "a",
          sourceObjectId: "/x",
          refString: "#/y",
        },
      ]),
      [],
    );
    expect(report.total).toBe(0);
    expect(report.diagnostics).toEqual([]);
    expect(issueSections(report)).toEqual([]);
    const text = formatIssueReport(report);
    expect(text).toContain("No issues found.");
    expect(text).toContain("Entry document: openapi.yaml");
  });

  it("groups broken/external/type-mismatch under 'Unresolved references' with status badges + located text", () => {
    const report = collectIssues(
      oad,
      refsOf([
        {
          status: "broken",
          kind: "$ref",
          sourceDocId: "a",
          sourceObjectId: "/paths/p",
          refString: "#/missing",
          requiredType: "Response",
        },
        {
          status: "external",
          kind: "$ref",
          sourceDocId: "a",
          sourceObjectId: "/c",
          refString: "ext.yaml#/X",
          requiredType: "Schema",
        },
        {
          status: "type-mismatch",
          kind: "$ref",
          sourceDocId: "b",
          sourceObjectId: "/d",
          refString: "#/e",
          requiredType: "Operation",
          targetType: "Schema",
        },
      ]),
      [],
    );
    const items = section(report, "unresolved");
    expect(items.map((i) => i.badge)).toEqual(["broken", "external", "type-mismatch"]);
    const broken = items[0]!;
    expect(broken.badgeClass).toBe("status-broken");
    expect(broken.doc).toBe("openapi.yaml");
    expect(broken.pointer).toBe("#/paths/p");
    expect(broken.fieldLabel).toBe("$ref");
    expect(broken.refString).toBe("#/missing");
    expect(broken.message).toMatch(/not found/);

    const text = formatIssueReport(report);
    expect(text).toContain("Unresolved references (3):");
    expect(text).toContain("[broken] openapi.yaml #/paths/p");
    expect(text).toContain("$ref: #/missing");
    expect(text).toContain("external document not loaded");
    expect(text).toContain("expected Operation, found Schema");
  });

  it("labels each reference kind in the text report", () => {
    const report = collectIssues(
      oad,
      refsOf([
        {
          status: "broken",
          resolution: "component-name",
          kind: "securityRequirement",
          sourceDocId: "a",
          sourceObjectId: "/s/0/apiKey",
          refString: "apiKey",
          requiredType: "SecurityScheme",
        },
        {
          status: "broken",
          resolution: "operation-id",
          kind: "operationId",
          sourceDocId: "a",
          sourceObjectId: "/l",
          refString: "noSuchOp",
          requiredType: "Operation",
        },
        {
          status: "broken",
          kind: "$dynamicRef",
          sourceDocId: "a",
          sourceObjectId: "/d",
          refString: "#NOPE",
          requiredType: "Schema",
        },
        {
          status: "broken",
          kind: "$recursiveRef",
          sourceDocId: "a",
          sourceObjectId: "/r",
          refString: "#",
          requiredType: "Schema",
        },
        {
          status: "broken",
          kind: "discriminatorMapping",
          sourceDocId: "a",
          sourceObjectId: "/m",
          refString: "Cat",
          requiredType: "Schema",
        },
      ]),
      [],
    );
    const text = formatIssueReport(report);
    expect(text).toContain('no Security Scheme component named "apiKey"');
    expect(text).toContain("security requirement: apiKey");
    expect(text).toContain("operationId: noSuchOp");
    expect(text).toContain("$dynamicRef: #NOPE");
    expect(text).toContain("$recursiveRef: #");
    expect(text).toContain("mapping value: Cat");
  });

  it("groups edge advisories under 'Reference advisories' by severity", () => {
    const report = collectIssues(
      oad,
      refsOf([
        {
          status: "resolved",
          kind: "operationRef",
          sourceDocId: "a",
          sourceObjectId: "/links/x",
          refString: "#/webhooks/hook/get",
          requiredType: "Operation",
          diagnostics: [
            {
              code: "operation-target-webhook",
              severity: "error",
              detail: "the target Operation is a webhook, which is not directly callable",
            },
          ],
        },
      ]),
      [],
    );
    expect(section(report, "unresolved")).toHaveLength(0); // the reference itself resolved
    const adv = section(report, "advisories");
    expect(adv).toHaveLength(1);
    expect(adv[0]!.badge).toBe("error");
    expect(adv[0]!.badgeClass).toBe("severity-error");

    const text = formatIssueReport(report);
    expect(text).toContain("Reference advisories (1):");
    expect(text).toContain("operationRef: #/webhooks/hook/get");
    expect(text).toContain("not directly callable");
  });

  it("collects node caveats AND the unsupported-dialect caveat into one section (the unified change)", () => {
    const root = node("", {
      children: [
        node("/components/schemas/X/$ref", {
          key: "$ref",
          resolutionAdvisories: [
            { code: "ignored-ref-siblings", detail: "keywords beside $ref are ignored: type" },
          ],
        }),
        node("/components/schemas/Y/$schema", {
          key: "$schema",
          dialectResolutionWarning: "this dialect's references are resolved with 2020-12 rules",
        }),
      ],
    });
    const withCaveats = {
      id: "a",
      filename: "openapi.yaml",
      isEntry: true,
      source: "upload",
      root,
    } as OadDocument;
    const report = collectIssues(
      { documents: [withCaveats], versionFamily: "3.1" },
      refsOf([]),
      [],
    );

    const caveats = section(report, "caveats");
    expect(caveats.map((i) => i.badge)).toEqual(["warning", "warning"]);
    expect(caveats[0]!.pointer).toBe("#/components/schemas/X/$ref");
    expect(caveats[1]!.pointer).toBe("#/components/schemas/Y/$schema");

    const text = formatIssueReport(report);
    expect(text).toContain("Reference-resolution advisories (2):");
    expect(text).toContain("keywords beside $ref are ignored");
    // The dialect caveat, formerly marker-only, now also appears in the report.
    expect(text).toContain("resolved with 2020-12 rules");
  });

  it("collects unreachable documents and unvalidated Schema Objects as document-level rows", () => {
    const warned = {
      id: "c",
      filename: "warn.yaml",
      source: "upload",
      schemaDialectWarning: "draft-07 Schema Objects were not validated",
    } as OadDocument;
    const report = collectIssues(
      { documents: [entry, other, warned], versionFamily: "3.1" },
      refsOf([]),
      [other],
    );

    expect(section(report, "unreachable")[0]!.doc).toBe("common.yaml");
    expect(section(report, "unreachable")[0]!.pointer).toBe(""); // no pointer for a document-level row
    expect(section(report, "unvalidated")[0]!.doc).toBe("warn.yaml");

    const text = formatIssueReport(report);
    expect(text).toContain("Unreachable documents (1):");
    expect(text).toContain("common.yaml — not reachable from the entry document");
    expect(text).toContain("Unvalidated Schema Objects (1):");
    expect(text).toContain("warn.yaml — draft-07 Schema Objects were not validated");
  });

  it("renders the root pointer as # and labels the entry (none) for an empty OAD", () => {
    const report = collectIssues(
      oad,
      refsOf([
        {
          status: "broken",
          kind: "$ref",
          sourceDocId: "a",
          sourceObjectId: "",
          refString: "#/missing",
          requiredType: "Schema",
        },
      ]),
      [],
    );
    expect(section(report, "unresolved")[0]!.pointer).toBe("#");
    expect(formatIssueReport(report)).toContain("[broken] openapi.yaml #");

    expect(collectIssues({ documents: [], versionFamily: "3.1" }, refsOf([]), []).entry).toBe(
      "(none)",
    );
  });

  it("orders sections and carries a unique key per row", () => {
    const report = collectIssues(
      oad,
      refsOf([
        {
          status: "broken",
          kind: "$ref",
          sourceDocId: "a",
          sourceObjectId: "/x",
          refString: "#/m",
          requiredType: "Schema",
        },
        {
          status: "resolved",
          kind: "operationRef",
          sourceDocId: "a",
          sourceObjectId: "/l",
          refString: "#/p",
          requiredType: "Operation",
          diagnostics: [
            { code: "operation-target-fragile", severity: "warning", detail: "one path" },
          ],
        },
      ]),
      [other],
    );
    expect(issueSections(report).map((s) => s.id)).toEqual([
      "unresolved",
      "advisories",
      "unreachable",
    ]);
    const keys = issueSections(report).flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
