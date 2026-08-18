// Registrations only, no I/O at construction — `createHandler`'s factory runs once per request
// (per the SDK's `createMcpHandler` model), so `createServer` must stay cheap and side-effect-free.

import { McpServer, createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import { runAnalysis } from "./analyze";
import { explainCode } from "./explain";
import { SERVER_NAME, TOOL_NAMES } from "./info";
import type { McpDeps } from "./ports";
import {
  AnalyzeInputSchema,
  AnalyzeOutputSchema,
  ExplainInputSchema,
  ExplainOutputSchema,
} from "./schemas";

export function createServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: deps.version });

  server.registerTool(
    TOOL_NAMES.analyzeDocument,
    {
      title: "Analyze an OpenAPI Description",
      description:
        "Load an OAD (one or more OpenAPI/JSON Schema documents) and return its diagnostics: " +
        "unresolved or mismatched references, reference advisories, resolution caveats, " +
        "unreachable documents, and unvalidated Schema Objects — the same findings the viewer's " +
        "issue report shows. Give either a bundled demo id or inline documents, not both.",
      inputSchema: AnalyzeInputSchema,
      outputSchema: AnalyzeOutputSchema,
      // openWorldHint: false is the honest encoding of "this tool never fetches a URL" — every
      // input is either a bundled demo or text supplied inline.
      annotations: {
        title: "Analyze an OpenAPI Description",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      const result = await runAnalysis(deps, args, ctx.mcpReq.signal);
      if (!result.ok) {
        return { content: [{ type: "text", text: result.message }], isError: true };
      }
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: result.structured,
      };
    },
  );

  server.registerTool(
    TOOL_NAMES.explainDiagnostic,
    {
      title: "Explain a diagnostic code",
      description:
        "Look up one diagnostic code in the catalog: its title, description, default severity, " +
        "and which issue-report section it belongs to.",
      inputSchema: ExplainInputSchema,
      outputSchema: ExplainOutputSchema,
      annotations: {
        title: "Explain a diagnostic code",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ code }) => {
      const result = explainCode(code);
      return {
        content: [{ type: "text", text: `${result.title}\n\n${result.description}` }],
        structuredContent: result,
      };
    },
  );

  return server;
}

export function createHandler(deps: McpDeps): McpHttpHandler {
  return createMcpHandler(() => createServer(deps));
}
