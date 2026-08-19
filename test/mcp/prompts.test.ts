import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TOOL_NAMES } from "../../src/mcp/info";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

describe("prompts", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it("lists both prompts", async () => {
    const { prompts } = await harness.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["explain-issue-report", "review-oad"]);
  });

  it("review-oad instructs the assistant to call analyze-document and summarize the focused section", async () => {
    const result = await harness.client.getPrompt({
      name: "review-oad",
      arguments: { demo: "refs", focus: "unresolved" },
    });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toContain(TOOL_NAMES.analyzeDocument);
    expect(text).toContain('"refs"');
    expect(text).toContain("unresolved");
  });

  it("explain-issue-report embeds the pasted report in a triage-plan message", async () => {
    const report = "OAS Structure Viewer — issue report\nEntry document: openapi.yaml";
    const result = await harness.client.getPrompt({
      name: "explain-issue-report",
      arguments: { report },
    });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toContain(report);
  });

  it("rejects review-oad when a required argument is missing", async () => {
    await expect(
      harness.client.getPrompt({ name: "review-oad", arguments: { demo: "refs" } }),
    ).rejects.toThrow();
  });
});
