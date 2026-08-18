// Registrations only, no I/O at construction — `createHandler`'s factory runs once per request
// (per the SDK's `createMcpHandler` model), so `createServer` must stay cheap and side-effect-free.

import {
  McpServer,
  createMcpHandler,
  type CacheHint,
  type ContentBlock,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { runAnalysis } from "./analyze";
import { demoById } from "../app/demos";
import { diagnosticCatalog } from "../diagnostics/catalog";
import { explainCode } from "./explain";
import { SERVER_NAME, TOOL_NAMES } from "./info";
import type { McpDeps } from "./ports";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";
import {
  AnalyzeInputSchema,
  AnalyzeOutputSchema,
  ExplainInputSchema,
  ExplainOutputSchema,
} from "./schemas";
import { demoUri, diagnosticUri } from "./uris";

// Every cacheable list/read here is build-time-static and identical for every caller, so a shared
// public hint is honest for all five operations the 2026-07-28 revision lets a server annotate.
const CACHE_HINT: CacheHint = { ttlMs: 3_600_000, cacheScope: "public" };

export function createServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: deps.version },
    {
      cacheHints: {
        "tools/list": CACHE_HINT,
        "prompts/list": CACHE_HINT,
        "resources/list": CACHE_HINT,
        "resources/templates/list": CACHE_HINT,
        "resources/read": CACHE_HINT,
      },
    },
  );

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
      // Only wire an emitter when the caller asked for progress — an unrequested notification would
      // upgrade the response to SSE for no reason, and the contrast with explain-diagnostic's plain
      // JSON response is the point of leaving the default `responseMode` alone.
      const progressToken = ctx.mcpReq._meta?.progressToken;
      const onProgress =
        progressToken === undefined
          ? undefined
          : async (progress: number, total: number, message: string) => {
              await ctx.mcpReq.notify({
                method: "notifications/progress",
                params: { progressToken, progress, total, message },
              });
            };

      const result = await runAnalysis(deps, args, ctx.mcpReq.signal, onProgress);
      if (!result.ok) {
        return { content: [{ type: "text", text: result.message }], isError: true };
      }

      const catalog = diagnosticCatalog();
      const codes = [...new Set(result.structured.diagnostics.map((d) => d.code))];
      const links: ContentBlock[] = codes.map(
        (code): ContentBlock => ({
          type: "resource_link",
          uri: diagnosticUri(code),
          name: catalog[code].title,
        }),
      );
      if (args.demo !== undefined) {
        links.push({
          type: "resource_link",
          uri: demoUri(args.demo),
          name: demoById(args.demo)?.label ?? args.demo,
        });
      }

      return {
        content: [{ type: "text", text: result.text }, ...links],
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
        content: [
          { type: "text", text: `${result.title}\n\n${result.description}` },
          { type: "resource_link", uri: result.catalogUri, name: result.title },
        ],
        structuredContent: result,
      };
    },
  );

  registerResources(server, deps);
  registerPrompts(server, deps);

  return server;
}

export function createHandler(deps: McpDeps): McpHttpHandler {
  return createMcpHandler(() => createServer(deps));
}
