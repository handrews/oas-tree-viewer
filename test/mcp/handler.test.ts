import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DIAGNOSTIC_CODES } from "../../src/diagnostics/types";
import { TOOL_NAMES } from "../../src/mcp/info";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

describe("mcp handler", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it("answers server/discover with the tools capability and the 2026-07-28 revision", async () => {
    const result = await harness.client.discover();
    expect(result.supportedVersions).toContain("2026-07-28");
    expect(result.capabilities.tools).toBeDefined();
  });

  it("lists exactly the two M1 tools", async () => {
    const { tools } = await harness.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([TOOL_NAMES.analyzeDocument, TOOL_NAMES.explainDiagnostic].sort());
  });

  it("advertises an input and an output schema for both tools", async () => {
    const { tools } = await harness.client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("advertises the read-only, non-destructive, closed-world annotations for both tools", async () => {
    const { tools } = await harness.client.listTools();
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it("enumerates every diagnostic code in explain-diagnostic's input schema", async () => {
    const { tools } = await harness.client.listTools();
    const explain = tools.find((t) => t.name === TOOL_NAMES.explainDiagnostic);
    const properties = explain?.inputSchema.properties as
      | Record<string, { enum?: string[] }>
      | undefined;
    expect(properties?.code?.enum).toHaveLength(DIAGNOSTIC_CODES.length);
    expect(properties?.code?.enum).toEqual(expect.arrayContaining([...DIAGNOSTIC_CODES]));
  });
});
