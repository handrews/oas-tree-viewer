import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { demos } from "../../src/app/demos";
import { demoDocuments, toInputs } from "../../src/mcp/documents";
import { bundledFixtures } from "../../src/mcp/fixtures.bundled";
import { runPipeline } from "../../src/app/bootstrap";
import { defaultConfig } from "../../src/app/config";
import { collectIssues, formatIssueReport } from "../../src/render/issues";
import { DIAGNOSTIC_CODES } from "../../src/diagnostics/types";
import { TOOL_NAMES } from "../../src/mcp/info";
import type { AnalyzeOutput } from "../../src/mcp/schemas";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

/** The text the tool's formatter *should* produce, computed independently through the same
 *  demoDocuments -> runPipeline -> collectIssues -> formatIssueReport chain the tool runs, so the
 *  comparison isn't circular against analyze.ts's own output. */
async function expectedText(id: string): Promise<string> {
  const docs = await demoDocuments(id, bundledFixtures);
  if (!docs) throw new Error(`fixture missing for demo "${id}"`);
  const demo = demos.find((d) => d.id === id)!;
  const result = await runPipeline(toInputs(docs), { ...defaultConfig, ...demo.config });
  if (!result.ok) throw new Error(`demo "${id}" did not load`);
  return formatIssueReport(collectIssues(result.oad, result.diagnostics));
}

describe("analyze-document — demos", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it.each(demos.map((d) => d.id))("loads demo %s cleanly with no docId leak", async (id) => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: { demo: id },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.structuredContent)).not.toContain("doc-");

    const structured = result.structuredContent as unknown as AnalyzeOutput;
    expect(structured.counts.total).toBe(structured.diagnostics.length);
    expect(structured.sections.reduce((sum, s) => sum + s.count, 0)).toBe(
      structured.diagnostics.length,
    );
    for (const d of structured.diagnostics) {
      expect(DIAGNOSTIC_CODES).toContain(d.code);
      expect(d.location.documentIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(demos.map((d) => d.id))(
    "content[0].text matches formatIssueReport for %s",
    async (id) => {
      const result = await harness.client.callTool({
        name: TOOL_NAMES.analyzeDocument,
        arguments: { demo: id },
      });
      expect(result.content[0]).toMatchObject({ type: "text", text: await expectedText(id) });
    },
  );

  it("the refs demo yields exactly the four documented diagnostics", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: { demo: "refs" },
    });
    const structured = result.structuredContent as unknown as AnalyzeOutput;
    const at = structured.diagnostics.map((d) => `${d.code} @ ${d.location.pointer}`).sort();
    expect(at).toEqual(
      [
        "ref-type-mismatch @ /paths/~1links/get/parameters/1",
        "ref-broken @ /paths/~1links/get/parameters/2",
        "ref-external @ /paths/~1links/get/parameters/3",
        "ref-type-mismatch @ /paths/~1links/get/responses/200/links/wrong",
      ].sort(),
    );
  });
});
