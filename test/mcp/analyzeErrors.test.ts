import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TOOL_NAMES } from "../../src/mcp/info";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

describe("analyze-document — errors", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it("a document that fails to parse comes back as isError, not a thrown protocol error", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [{ filename: "broken.yaml", text: "{ not: valid: yaml: [", isEntry: true }],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("an unknown demo id comes back as isError", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: { demo: "does-not-exist" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/does-not-exist/);
  });

  it("both demo and documents supplied comes back as isError", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        demo: "refs",
        documents: [{ filename: "x.yaml", text: "openapi: 3.1.0", isEntry: true }],
      },
    });
    expect(result.isError).toBe(true);
  });

  it("neither demo nor documents supplied comes back as isError", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("mixed OAS version families across documents comes back as isError (OAD-level error path)", async () => {
    const v30 = "openapi: 3.0.4\ninfo: { title: A, version: '1' }\npaths: {}\n";
    const v31 = "openapi: 3.1.0\ninfo: { title: B, version: '1' }\npaths: {}\n";
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "a.yaml", text: v30, isEntry: true },
          { filename: "b.yaml", text: v31, isEntry: false },
        ],
      },
    });
    expect(result.isError).toBe(true);
  });
});
