import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DIAGNOSTIC_CODES } from "../../src/diagnostics/types";
import { diagnosticCatalog, severityFor } from "../../src/diagnostics/catalog";
import { sectionForCode } from "../../src/render/issues";
import { diagnosticUri } from "../../src/mcp/uris";
import { TOOL_NAMES } from "../../src/mcp/info";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

describe("explain-diagnostic", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it.each(DIAGNOSTIC_CODES)("matches the catalog for %s", async (code) => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.explainDiagnostic,
      arguments: { code },
    });
    expect(result.isError).toBeFalsy();
    const catalog = diagnosticCatalog()[code];
    const defaultSeverity = severityFor(code);
    expect(result.structuredContent).toEqual({
      code,
      title: catalog.title,
      description: catalog.description,
      defaultSeverity,
      enabled: defaultSeverity !== "off",
      section: sectionForCode(code),
      catalogUri: diagnosticUri(code),
    });
  });

  it("rejects an unknown code before the handler runs", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.explainDiagnostic,
      arguments: { code: "not-a-real-code" },
    });
    expect(result.isError).toBe(true);
  });
});
