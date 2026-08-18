// Shared in-process harness: a real Client driven over a real createMcpHandler, with no socket and
// no mock transport — see the SDK's testing guide. Every spec in this directory connects through
// this one function so the wiring can't drift between specs.

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
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
