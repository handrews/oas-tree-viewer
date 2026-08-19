// Shared in-process harness: a real Client driven over a real createMcpHandler, with no socket and
// no mock transport — see the SDK's testing guide. Every spec in this directory connects through
// this one function so the wiring can't drift between specs.

import {
  Client,
  StreamableHTTPClientTransport,
  type ElicitResult,
} from "@modelcontextprotocol/client";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { createHandler } from "../../src/mcp/server";
import { bundledFixtures } from "../../src/mcp/fixtures.bundled";
import type { McpDeps } from "../../src/mcp/ports";

export interface TestHarness {
  client: Client;
  handler: McpHttpHandler;
}

const defaultDeps: McpDeps = { fixtures: bundledFixtures, version: "test" };

export async function connectTestClient(
  deps: McpDeps = defaultDeps,
  // Lets progress.test.ts inspect a response's content-type (json vs. the SSE upgrade) without every
  // other spec needing to know this hook exists.
  onFetch?: (response: Response) => void,
): Promise<TestHarness> {
  const handler = createHandler(deps);
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: async (url, init) => {
      const response = await handler.fetch(new Request(url, init));
      onFetch?.(response);
      return response;
    },
  });
  const client = new Client(
    { name: "test", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);
  return { client, handler };
}

export async function closeTestClient({ client, handler }: TestHarness): Promise<void> {
  await client.close();
  await handler.close();
}

/** One JSON-RPC request this harness's client sent, and the plain-JSON result it got back (`mrtr.test.ts`
 *  never requests progress, so every response here is `application/json`, never SSE). */
export interface RecordedExchange {
  id: unknown;
  method: string;
  params: Record<string, unknown>;
  result?: unknown;
}

export interface MrtrHarness extends TestHarness {
  /** Every JSON-RPC request/response pair on the wire, in order — this is how a test proves two
   *  `tools/call` exchanges happened with different ids, and inspects `requestState` directly. */
  exchanges: RecordedExchange[];
}

/**
 * A client that declares the `elicitation` capability and answers `elicitation/create` with
 * `answer`, recording every JSON-RPC exchange as it goes. `answer` sees the same
 * `{message, requestedSchema}` the server sent, so one handler can distinguish the "entry" question
 * from the "fragments" one by its schema — exactly as `ElicitPanel.svelte` would render either.
 */
export async function connectMrtrClient(
  answer: (params: { message: string; requestedSchema: unknown }) => ElicitResult,
  deps: McpDeps = defaultDeps,
): Promise<MrtrHarness> {
  const handler = createHandler(deps);
  const exchanges: RecordedExchange[] = [];
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: async (url, init) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { id?: unknown; method?: string; params?: unknown })
        : {};
      const res = await handler.fetch(new Request(url, init));
      if (body.method) {
        const text = await res.clone().text();
        let result: unknown;
        try {
          result = (JSON.parse(text) as { result?: unknown }).result;
        } catch {
          // An SSE body (not used by any mrtr.test.ts call) — nothing to record.
        }
        exchanges.push({
          id: body.id,
          method: body.method,
          params: (body.params ?? {}) as Record<string, unknown>,
          result,
        });
      }
      return res;
    },
  });
  const client = new Client(
    { name: "test-mrtr", version: "1" },
    {
      versionNegotiation: { mode: "auto" },
      capabilities: { elicitation: { form: {} } },
      inputRequired: { maxRounds: 5 },
    },
  );
  client.setRequestHandler("elicitation/create", (request) => {
    if (request.params.mode === "url") return { action: "cancel" };
    return answer({
      message: request.params.message,
      requestedSchema: request.params.requestedSchema,
    });
  });
  await client.connect(transport);
  return { client, handler, exchanges };
}
