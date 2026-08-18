import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { demos } from "../../src/app/demos";
import { demoDocuments } from "../../src/mcp/documents";
import { bundledFixtures } from "../../src/mcp/fixtures.bundled";
import { demoDocUri, demoUri, diagnosticUri } from "../../src/mcp/uris";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

describe("completion — resource template variables", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it("completes a diagnostic code", async () => {
    const result = await harness.client.complete({
      ref: { type: "ref/resource", uri: diagnosticUri("{code}") },
      argument: { name: "code", value: "ref-b" },
    });
    expect(result.completion.values).toEqual(["ref-broken"]);
  });

  it("completes a demo id", async () => {
    const result = await harness.client.complete({
      ref: { type: "ref/resource", uri: demoUri("{demoId}") },
      argument: { name: "demoId", value: "ref" },
    });
    expect(result.completion.values).toContain("refs");
  });

  it("completes a demo document's filename, scoped by the chosen demoId", async () => {
    const docs = await demoDocuments("refs", bundledFixtures);
    const result = await harness.client.complete({
      ref: { type: "ref/resource", uri: demoDocUri("{demoId}", "{filename}") },
      argument: { name: "filename", value: "" },
      context: { arguments: { demoId: "refs" } },
    });
    expect(result.completion.values.sort()).toEqual(docs!.map((d) => d.filename).sort());
  });

  it("returns nothing for a filename completion with no demoId chosen yet", async () => {
    const result = await harness.client.complete({
      ref: { type: "ref/resource", uri: demoDocUri("{demoId}", "{filename}") },
      argument: { name: "filename", value: "" },
    });
    expect(result.completion.values).toEqual([]);
  });

  it("returns nothing for a filename completion scoped to an unknown demoId", async () => {
    const result = await harness.client.complete({
      ref: { type: "ref/resource", uri: demoDocUri("{demoId}", "{filename}") },
      argument: { name: "filename", value: "" },
      context: { arguments: { demoId: "does-not-exist" } },
    });
    expect(result.completion.values).toEqual([]);
  });

  it("completes the demoId variable on the document template too", async () => {
    const result = await harness.client.complete({
      ref: { type: "ref/resource", uri: demoDocUri("{demoId}", "{filename}") },
      argument: { name: "demoId", value: "self" },
    });
    expect(result.completion.values).toEqual(["self"]);
  });
});

describe("completion — prompt arguments", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it("completes review-oad's demo argument", async () => {
    const result = await harness.client.complete({
      ref: { type: "ref/prompt", name: "review-oad" },
      argument: { name: "demo", value: "" },
    });
    expect(result.completion.values.sort()).toEqual(demos.map((d) => d.id).sort());
  });

  it("completes review-oad's focus argument to the five section ids", async () => {
    const result = await harness.client.complete({
      ref: { type: "ref/prompt", name: "review-oad" },
      argument: { name: "focus", value: "un" },
    });
    expect(result.completion.values.sort()).toEqual(
      ["unresolved", "unreachable", "unvalidated"].sort(),
    );
  });
});
