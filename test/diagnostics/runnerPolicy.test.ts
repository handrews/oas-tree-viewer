// The catalog ships no `off` codes, so the runner's "policed off → skip" path is exercised here by
// mocking severityFor to silence one code. Kept in its own file because vi.mock is file-scoped.
import { describe, it, expect, vi } from "vitest";
import type { DiagnosticCode } from "../../src/diagnostics/types";

vi.mock("../../src/diagnostics/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/diagnostics/catalog")>();
  return {
    ...actual,
    severityFor: (code: DiagnosticCode) =>
      code === "ref-broken" ? "off" : actual.severityFor(code),
  };
});

import { buildDiagnostics } from "../../src/diagnostics/runner";
import type { Oad, OadDocument } from "../../src/types";
import type { ReferenceEdge, ResolvedRefs } from "../../src/refs/types";

const refsOf = (edges: Array<Partial<ReferenceEdge>>): ResolvedRefs => ({
  edges: edges as ReferenceEdge[],
  bySource: new Map(),
  byTarget: new Map(),
});
const oad: Oad = {
  documents: [{ id: "a", filename: "o.yaml", isEntry: true, source: "upload" } as OadDocument],
  versionFamily: "3.1",
};

describe("diagnostic policy: a code policed to off is silenced", () => {
  it("drops the off code, keeps the rest", () => {
    const ds = buildDiagnostics(
      oad,
      refsOf([
        {
          status: "broken",
          kind: "$ref",
          sourceDocId: "a",
          sourceObjectId: "/x",
          refString: "#/n",
        },
        {
          status: "external",
          kind: "$ref",
          sourceDocId: "a",
          sourceObjectId: "/y",
          refString: "e#/z",
        },
      ]),
      [],
    );
    expect(ds.find((d) => d.code === "ref-broken")).toBeUndefined();
    expect(ds.find((d) => d.code === "ref-external")).toBeDefined();
  });
});
