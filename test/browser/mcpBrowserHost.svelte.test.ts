import { expect, test } from "vitest";
import { browserFixtures } from "../../src/mcp/fixtures.browser";
import { bundledFixtures } from "../../src/mcp/fixtures.bundled";
import { demoDocuments } from "../../src/mcp/documents";
import { demos } from "../../src/app/demos";
import { CONNECT_ACTION } from "../../src/mcp/info";
import { McpBrowserHost, type WireExchange, type PendingElicit } from "../../src/mcp/hosts/browser";

// A bare Path Item Object fragment (no openapi/$id/$schema) — loads only with document fragments
// enabled, referenced at its root by ENTRY.
const ENTRY = `
openapi: 3.0.4
info: { title: Entry, version: "1.0" }
paths:
  /pets:
    $ref: pathitem.yaml
`;
const PATHITEM = `
get:
  operationId: listPets
  responses:
    '200':
      description: ok
`;

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

// The MRTR round trip end to end, over the real production wiring in hosts/browser.ts: the client
// capability declaration, the registered `elicitation/create` handler, and the `onElicit` callback
// `ElicitPanel.svelte` would render — here a stand-in "panel" answers as soon as one appears, exactly
// as clicking Submit would. This is the wire-log proof the plan asks for: two `tools/call` exchanges
// with different JSON-RPC ids, the second carrying `inputResponses`.
test("McpBrowserHost drives the fragment-consent MRTR round trip through a real elicitation handler", async () => {
  let log: WireExchange[] = [];
  let pending: PendingElicit | null = null;
  const host = new McpBrowserHost(
    (snapshot) => (log = snapshot),
    (p) => {
      pending = p;
      // Answer as soon as a request appears — the async microtask this schedules runs before the
      // client's retry can be issued, same as a human clicking Submit would (just faster).
      if (p) {
        void Promise.resolve().then(() =>
          p.respond({ action: "accept", content: { fragments: "root" } }),
        );
      }
    },
  );
  await host.connected;

  const result = await host.client.callTool({
    name: "analyze-document",
    arguments: {
      documents: [
        { filename: "entry.yaml", text: ENTRY, isEntry: true },
        { filename: "pathitem.yaml", text: PATHITEM, isEntry: false },
      ],
    },
  });

  expect(result.isError).toBeFalsy();
  expect(pending).toBeNull(); // cleared once answered

  const calls = log.filter((e) => e.method === "tools/call");
  expect(calls).toHaveLength(2);
  const firstId = (calls[0]!.requestBody as { id: unknown }).id;
  const secondId = (calls[1]!.requestBody as { id: unknown }).id;
  expect(firstId).not.toBe(secondId);
  const secondParams = (calls[1]!.requestBody as { params: { inputResponses?: unknown } }).params;
  expect(secondParams.inputResponses).toMatchObject({
    fragments: { action: "accept", content: { fragments: "root" } },
  });

  await host.close();
});

// WireLog.svelte groups exchanges by `WireExchange.action` (see hosts/browser.ts's header): a
// `beginAction` call stamps every exchange until the next one, so an elicitation retry — issued from
// inside the same `client.callTool()` the page already labeled — shares its originating call's label
// without the page doing anything extra. That's what lets the round trip render as one group.
test("beginAction labels an elicitation round trip's two exchanges the same, distinct from the label before it", async () => {
  let log: WireExchange[] = [];
  let pending: PendingElicit | null = null;
  const host = new McpBrowserHost(
    (snapshot) => (log = snapshot),
    (p) => {
      pending = p;
      if (p) {
        void Promise.resolve().then(() =>
          p.respond({ action: "accept", content: { fragments: "root" } }),
        );
      }
    },
  );
  await host.connected;
  await host.client.listTools(); // stands in for the page's own connect-time capability discovery

  host.beginAction("Call analyze-document");
  await host.client.callTool({
    name: "analyze-document",
    arguments: {
      documents: [
        { filename: "entry.yaml", text: ENTRY, isEntry: true },
        { filename: "pathitem.yaml", text: PATHITEM, isEntry: false },
      ],
    },
  });
  expect(pending).toBeNull();

  const calls = log.filter((e) => e.method === "tools/call");
  expect(calls).toHaveLength(2);
  expect(calls[0]!.action).toBe("Call analyze-document");
  expect(calls[1]!.action).toBe("Call analyze-document");
  // Everything logged before the first `beginAction` call — the connect + capability discovery — is
  // its own, distinct label.
  expect(log.some((e) => e.action === CONNECT_ACTION)).toBe(true);

  await host.close();
});
