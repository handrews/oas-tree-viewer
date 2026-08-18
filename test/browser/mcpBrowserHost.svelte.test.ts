import { expect, test } from "vitest";
import { browserFixtures } from "../../src/mcp/fixtures.browser";
import { bundledFixtures } from "../../src/mcp/fixtures.bundled";
import { demoDocuments } from "../../src/mcp/documents";
import { demos } from "../../src/app/demos";
import { McpBrowserHost, type WireExchange } from "../../src/mcp/hosts/browser";

// `browserFixtures` fetches the same `/fixtures/…` files `bundledFixtures` bundled at build time
// (fixtures.bundled.ts) — this is what makes Node/browser parity a tautology rather than a hope (see
// documents.ts's file header). Covers every demo's InlineDoc[] in one pass, not just one.
test("browserFixtures reproduces the same InlineDoc[] as bundledFixtures, for every demo", async () => {
  for (const demo of demos) {
    const nodeDocs = await demoDocuments(demo.id, bundledFixtures);
    const browserDocs = await demoDocuments(demo.id, browserFixtures);
    expect(browserDocs).toEqual(nodeDocs);
  }
});

// The live host end to end: a real Client, connected in-process, calling a real tool and logging the
// real wire exchange — headers, method, and (because analyze-document reports progress) the decoded
// SSE frames in order.
test("McpBrowserHost connects a real Client and logs the real wire exchange, SSE frames included", async () => {
  let log: WireExchange[] = [];
  const host = new McpBrowserHost((snapshot) => (log = snapshot));
  await host.connected;

  const result = await host.client.callTool(
    { name: "analyze-document", arguments: { demo: "refs" } },
    { onprogress: () => {} },
  );
  expect(result.isError).toBeFalsy();

  await expect
    .poll(() => log.find((e) => e.method === "tools/call")?.pending === false, { timeout: 5000 })
    .toBe(true);

  const call = log.find((e) => e.method === "tools/call")!;
  expect(call.requestHeaders["mcp-method"]).toBe("tools/call");
  expect(call.requestHeaders["mcp-name"]).toBe("analyze-document");
  expect(call.requestHeaders["mcp-protocol-version"]).toBe("2026-07-28");
  expect(call.status).toBe(200);
  expect(call.contentType).toContain("text/event-stream");
  expect(call.frames.length).toBeGreaterThan(0);
  expect(call.frames.some((f) => f.data.includes("notifications/progress"))).toBe(true);
  expect(call.frames.at(-1)?.data).toContain('"resultType":"complete"');

  // explain-diagnostic emits no progress, so it answers plain JSON — the contrast the wire log exists
  // to show.
  await host.client.callTool({ name: "explain-diagnostic", arguments: { code: "ref-broken" } });
  await expect
    .poll(() => log.filter((e) => e.method === "tools/call").at(-1)?.pending === false, {
      timeout: 5000,
    })
    .toBe(true);
  const explainCall = log.filter((e) => e.method === "tools/call").at(-1)!;
  expect(explainCall.contentType).toBe("application/json");
  expect(explainCall.frames.length).toBe(0);
  expect(explainCall.json).toBeDefined();

  await host.close();
});
