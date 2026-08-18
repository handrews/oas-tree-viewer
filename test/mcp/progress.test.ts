import { describe, it, expect, afterEach } from "vitest";
import { demos } from "../../src/app/demos";
import { runAnalysis } from "../../src/mcp/analyze";
import { bundledFixtures } from "../../src/mcp/fixtures.bundled";
import { TOOL_NAMES } from "../../src/mcp/info";
import type { McpDeps } from "../../src/mcp/ports";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

const deps: McpDeps = { fixtures: bundledFixtures, version: "test" };

interface Event {
  progress: number;
  total: number;
  message: string;
}

function collector(): {
  events: Event[];
  onProgress: (progress: number, total: number, message: string) => void;
} {
  const events: Event[] = [];
  return {
    events,
    onProgress: (progress, total, message) => events.push({ progress, total, message }),
  };
}

describe("runAnalysis — progress (unit)", () => {
  it("reports one step per document plus resolve/pipeline/collect, strictly increasing", async () => {
    const demo = demos.find((d) => d.id === "refs")!;
    const { events, onProgress } = collector();
    const result = await runAnalysis(
      deps,
      { demo: "refs", minSeverity: "info" },
      undefined,
      onProgress,
    );
    expect(result.ok).toBe(true);
    expect(events).toHaveLength(demo.inputs.length + 3);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].progress).toBeGreaterThan(events[i - 1].progress);
    }
    expect(events[0].message).toBe('resolving demo "refs"');
    expect(events.some((e) => e.message.includes("refs-3.1.yaml"))).toBe(true);
    expect(events.at(-1)!.progress).toBe(events.at(-1)!.total);
    expect(events.at(-2)!.message).toContain("running load");
    expect(events.at(-1)!.message).toContain("collecting");
  });

  it("reports one step per inline document too", async () => {
    const { events, onProgress } = collector();
    const documents = [
      {
        filename: "a.yaml",
        text: "openapi: 3.1.0\ninfo: { title: A, version: '1' }\npaths: {}\n",
        isEntry: true,
      },
    ];
    const result = await runAnalysis(
      deps,
      { documents, minSeverity: "info" },
      undefined,
      onProgress,
    );
    expect(result.ok).toBe(true);
    expect(events).toHaveLength(documents.length + 3);
    expect(events[0].message).toBe("resolving 1 inline document(s)");
    expect(events[1].message).toMatch(/^read a\.yaml \(\d+ bytes\)$/);
  });

  it("never reports progress when the caller passes no callback", async () => {
    const result = await runAnalysis(deps, { demo: "refs", minSeverity: "info" });
    expect(result.ok).toBe(true);
  });

  it("stops before reading a document once the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { onProgress } = collector();
    await expect(
      runAnalysis(deps, { demo: "refs", minSeverity: "info" }, controller.signal, onProgress),
    ).rejects.toThrow(/cancelled/);
  });
});

describe("analyze-document — progress (over the protocol)", () => {
  let harness: TestHarness;

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it("upgrades the response to SSE and delivers strictly increasing progress when requested", async () => {
    let contentType: string | null = null;
    harness = await connectTestClient(undefined, (res) => {
      contentType = res.headers.get("content-type");
    });
    const events: Event[] = [];
    const result = await harness.client.callTool(
      { name: TOOL_NAMES.analyzeDocument, arguments: { demo: "refs" } },
      { onprogress: (update) => events.push(update as Event) },
    );
    expect(result.isError).toBeFalsy();
    expect(events.length).toBeGreaterThanOrEqual(
      demos.find((d) => d.id === "refs")!.inputs.length + 2,
    );
    for (let i = 1; i < events.length; i++) {
      expect(events[i].progress).toBeGreaterThan(events[i - 1].progress);
    }
    expect(contentType).toMatch(/^text\/event-stream/);
  });

  it("stays a plain JSON response when the caller does not request progress", async () => {
    let contentType: string | null = null;
    harness = await connectTestClient(undefined, (res) => {
      contentType = res.headers.get("content-type");
    });
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: { demo: "refs" },
    });
    expect(result.isError).toBeFalsy();
    expect(contentType).toMatch(/^application\/json/);
  });
});
