import { describe, it, expect } from "vitest";
import { buildDiagnostics, indexByPointer } from "../../src/diagnostics/runner";
import type { Diagnostic } from "../../src/diagnostics/types";
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
function oadWith(...documents: OadDocument[]): Oad {
  return { documents, versionFamily: "3.1" };
}
const codes = (ds: Diagnostic[], code: string): Diagnostic[] => ds.filter((d) => d.code === code);

const entry = doc("a", "openapi.yaml", true);
const other = doc("b", "common.yaml");

describe("buildDiagnostics", () => {
  it("emits nothing for a clean resolved reference", () => {
    const ds = buildDiagnostics(
      oadWith(entry, other),
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
    expect(ds).toEqual([]);
  });

  it("emits located, severity-stamped diagnostics for broken / external / type-mismatch refs", () => {
    const ds = buildDiagnostics(
      oadWith(entry, other),
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

    const broken = codes(ds, "ref-broken")[0]!;
    expect(broken.severity).toBe("error");
    expect(broken.source).toBe("reference");
    expect(broken.location).toEqual({ docId: "a", pointer: "/paths/p" });
    expect(broken.message).toMatch(/not found/);
    expect(broken.ref).toEqual({ kind: "$ref", refString: "#/missing" });
    expect(broken.relatedLocations).toBeUndefined(); // no located target

    expect(codes(ds, "ref-external")[0]!.severity).toBe("warning");
    expect(codes(ds, "ref-type-mismatch")[0]!.message).toBe("expected Operation, found Schema");
  });

  it("describes broken component-name and operationId references, and an unknown type-mismatch", () => {
    const ds = buildDiagnostics(
      oadWith(entry),
      refsOf([
        {
          status: "broken",
          resolution: "component-name",
          kind: "securityRequirement",
          sourceDocId: "a",
          sourceObjectId: "/security/0/apiKey",
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
          status: "type-mismatch",
          kind: "$ref",
          sourceDocId: "a",
          sourceObjectId: "/t",
          refString: "#/x",
          requiredType: "Schema",
        }, // no targetType -> "found ?"
      ]),
      [],
    );
    const broken = codes(ds, "ref-broken");
    expect(broken.map((d) => d.message)).toEqual([
      'no Security Scheme component named "apiKey"',
      'no Operation declares operationId "noSuchOp"',
    ]);
    expect(codes(ds, "ref-type-mismatch")[0]!.message).toBe("expected Schema, found ?");
  });

  it("stamps an edge advisory from the catalog (not the edge), with the resolved target as related", () => {
    const ds = buildDiagnostics(
      oadWith(entry),
      refsOf([
        {
          status: "resolved",
          kind: "operationRef",
          sourceDocId: "a",
          sourceObjectId: "/links/L",
          refString: "#/webhooks/hook/get",
          requiredType: "Operation",
          targetDocId: "a",
          targetNodeId: "/webhooks/hook/get",
          // The edge claims "warning"; the catalog says operation-target-webhook is an error — the
          // catalog is the single source of truth, so the emitted severity must be "error".
          diagnostics: [
            {
              code: "operation-target-webhook",
              severity: "warning",
              detail: "points at a webhook",
            },
          ],
        },
      ]),
      [],
    );
    expect(codes(ds, "ref-broken")).toHaveLength(0); // the reference itself resolved
    const adv = codes(ds, "operation-target-webhook")[0]!;
    expect(adv.severity).toBe("error");
    expect(adv.source).toBe("reference");
    expect(adv.location).toEqual({ docId: "a", pointer: "/links/L" });
    expect(adv.relatedLocations).toEqual([{ docId: "a", pointer: "/webhooks/hook/get" }]);
    expect(adv.ref).toEqual({ kind: "operationRef", refString: "#/webhooks/hook/get" });
  });

  it("keeps a fragile operation-target advisory at warning severity", () => {
    const ds = buildDiagnostics(
      oadWith(entry),
      refsOf([
        {
          status: "resolved",
          kind: "operationRef",
          sourceDocId: "a",
          sourceObjectId: "/links/F",
          refString: "#/components/pathItems/x/get",
          requiredType: "Operation",
          diagnostics: [
            { code: "operation-target-fragile", severity: "warning", detail: "one path" },
          ],
        },
      ]),
      [],
    );
    expect(codes(ds, "operation-target-fragile")[0]!.severity).toBe("warning");
  });

  it("emits document-level diagnostics: unreachable documents and unvalidated Schema Objects", () => {
    const warned = {
      id: "c",
      filename: "warn.yaml",
      source: "upload",
      schemaDialectWarning: "draft-07 Schema Objects were not validated",
    } as OadDocument;
    const ds = buildDiagnostics(oadWith(entry, other, warned), refsOf([]), [other]);

    const unreachable = codes(ds, "document-unreachable")[0]!;
    expect(unreachable.severity).toBe("warning");
    expect(unreachable.source).toBe("reference");
    expect(unreachable.location).toEqual({ docId: "b", pointer: "" });
    expect(unreachable.message).toMatch(/not reachable/);

    const unvalidated = codes(ds, "schema-unvalidated")[0]!;
    expect(unvalidated.source).toBe("schema");
    expect(unvalidated.location).toEqual({ docId: "c", pointer: "" });
    expect(unvalidated.message).toBe("draft-07 Schema Objects were not validated");
  });

  it("emits node-level caveats: draft-06/07 advisories and an unsupported-to-resolve dialect", () => {
    const root = node("", {
      children: [
        node("/components/schemas/X/$ref", {
          key: "$ref",
          resolutionAdvisories: [
            { code: "ignored-ref-siblings", detail: "siblings ignored: type" },
          ],
        }),
        node("/components/schemas/Y/$id", {
          key: "$id",
          resolutionAdvisories: [{ code: "invalid-id-fragment", detail: "names nothing" }],
        }),
        node("/components/schemas/Z/$schema", {
          key: "$schema",
          dialectResolutionWarning: "resolved with 2020-12 rules",
        }),
      ],
    });
    const withNodes = {
      id: "a",
      filename: "openapi.yaml",
      isEntry: true,
      source: "upload",
      root,
    } as OadDocument;
    const ds = buildDiagnostics(oadWith(withNodes), refsOf([]), []);

    expect(codes(ds, "ignored-ref-siblings")[0]!.location).toEqual({
      docId: "a",
      pointer: "/components/schemas/X/$ref",
    });
    expect(codes(ds, "invalid-id-fragment")[0]!.severity).toBe("warning");
    const dialect = codes(ds, "dialect-resolution-unsupported")[0]!;
    expect(dialect.source).toBe("schema");
    expect(dialect.location).toEqual({ docId: "a", pointer: "/components/schemas/Z/$schema" });
    expect(dialect.message).toBe("resolved with 2020-12 rules");
  });
});

describe("indexByPointer", () => {
  it("groups diagnostics by docId then pointer, preserving order", () => {
    const diags: Diagnostic[] = [
      {
        code: "ref-broken",
        severity: "error",
        source: "reference",
        message: "m1",
        location: { docId: "a", pointer: "/x" },
      },
      {
        code: "ref-external",
        severity: "warning",
        source: "reference",
        message: "m2",
        location: { docId: "a", pointer: "/x" },
      },
      {
        code: "document-unreachable",
        severity: "warning",
        source: "reference",
        message: "m3",
        location: { docId: "b", pointer: "" },
      },
    ];
    const idx = indexByPointer(diags);
    expect(
      idx
        .get("a")!
        .get("/x")!
        .map((d) => d.code),
    ).toEqual(["ref-broken", "ref-external"]);
    expect(idx.get("b")!.get("")).toHaveLength(1);
  });
});
