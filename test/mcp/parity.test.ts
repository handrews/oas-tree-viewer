// Every demo's structuredContent against a committed golden — the node half of browser/Node parity
// (see test/browser/mcpBrowserHost.svelte.test.ts). Regenerate a golden only when a deliberate
// output change makes it stale; a spontaneous diff here means output stopped being deterministic.

import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { demos } from "../../src/app/demos";
import { TOOL_NAMES } from "../../src/mcp/info";
import type { AnalyzeOutput } from "../../src/mcp/schemas";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

function golden(id: string): AnalyzeOutput {
  const url = new URL(`./__fixtures__/parity/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as AnalyzeOutput;
}

describe("parity — structuredContent against committed goldens", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it.each(demos.map((d) => d.id))("matches the golden for %s", async (id) => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: { demo: id },
    });
    expect(result.structuredContent).toEqual(golden(id));
  });

  it("is byte-identical across two calls in the same process (the docId hazard, contained)", async () => {
    const first = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: { demo: "self" },
    });
    const second = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: { demo: "self" },
    });
    expect(JSON.stringify(second.structuredContent)).toBe(JSON.stringify(first.structuredContent));
  });
});
