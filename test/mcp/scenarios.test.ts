import { describe, it, expect, afterEach } from "vitest";
import type { ElicitResult } from "@modelcontextprotocol/client";
import { scenarios, scenarioById } from "../../src/mcp/scenarios";
import { MAX_INLINE_DOCS, MAX_DOC_CHARS, TOOL_NAMES } from "../../src/mcp/info";
import { connectMrtrClient, closeTestClient, type MrtrHarness } from "./testHarness";

describe("scenarios", () => {
  it("looks a scenario up by id, and reports an unknown one as undefined", () => {
    expect(scenarioById("fragment-consent")?.label).toBe("A document fragment");
    expect(scenarioById("nope")).toBeUndefined();
  });

  it("carries documents the analyze-document tool will accept", () => {
    for (const scenario of scenarios) {
      expect(scenario.docs.length).toBeGreaterThan(0);
      expect(scenario.docs.length).toBeLessThanOrEqual(MAX_INLINE_DOCS);
      expect(scenario.docs.filter((d) => d.isEntry)).toHaveLength(1);
      expect(scenario.docs.reduce((n, d) => n + d.text.length, 0)).toBeLessThanOrEqual(
        MAX_DOC_CHARS,
      );
    }
  });
});

// A scenario exists only to reach the `input_required` path, so a scenario that stopped triggering
// one would be silently useless — the page would offer it and nothing would be demonstrated.
describe("every scenario actually elicits", () => {
  let harness: MrtrHarness | undefined;

  afterEach(async () => {
    if (harness) await closeTestClient(harness);
    harness = undefined;
  });

  it.each(scenarios.map((s) => s.id))(
    "%s reaches an elicitation and resolves once answered",
    async (id) => {
      const asked: string[] = [];
      harness = await connectMrtrClient((params): ElicitResult => {
        asked.push(params.message);
        return { action: "accept", content: { fragments: "root" } };
      });

      const result = await harness.client.callTool({
        name: TOOL_NAMES.analyzeDocument,
        arguments: { documents: scenarioById(id)!.docs },
      });

      expect(asked).toHaveLength(1);
      expect(result.isError).toBeFalsy();
      expect(harness.exchanges.filter((e) => e.method === "tools/call")).toHaveLength(2);
    },
  );
});
