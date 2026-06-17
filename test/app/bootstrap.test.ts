import { describe, it, expect } from "vitest";
import { runPipeline, docLabel } from "../../src/app/bootstrap";
import type { OadDocument } from "../../src/types";

const valid = (title: string, version = "3.1.0"): string =>
  `openapi: ${version}\ninfo: { title: ${title}, version: '1' }\npaths: {}\n`;

describe("runPipeline", () => {
  it("loads, assembles, and resolves a valid OAD", async () => {
    const r = await runPipeline([
      { source: "upload", filename: "a.yaml", text: valid("A"), isEntry: true },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.oad.documents).toHaveLength(1);
      expect(r.refs).toBeTruthy();
    }
  });

  it("reports a per-row error for a non-OpenAPI document", async () => {
    const r = await runPipeline([
      { source: "upload", filename: "x.yaml", text: "just: data\n", isEntry: true },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rowErrors?.[0]).toBeTruthy();
  });

  it("reports an OAD-level error for mixed OAS versions", async () => {
    const r = await runPipeline([
      { source: "upload", filename: "a.yaml", text: valid("A", "3.1.0"), isEntry: true },
      { source: "upload", filename: "b.yaml", text: valid("B", "3.2.0"), isEntry: false },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.oadError).toMatch(/3\.1 and 3\.2/i);
  });
});

describe("docLabel", () => {
  it("prefers filename, then retrievalUri, then a source fallback", () => {
    expect(docLabel({ filename: "f.yaml" } as OadDocument, "fb")).toBe("f.yaml");
    expect(docLabel({ retrievalUri: "https://x/y" } as OadDocument, "fb")).toBe("https://x/y");
    expect(docLabel({ source: "url" } as OadDocument, "fb")).toBe("(url document)");
    expect(docLabel(undefined, "fb")).toBe("fb");
  });
});
