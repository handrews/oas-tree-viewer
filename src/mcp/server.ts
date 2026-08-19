// Registrations only, no I/O at construction — `createHandler`'s factory runs once per request
// (per the SDK's `createMcpHandler` model), so `createServer` must stay cheap and side-effect-free.

import {
  McpServer,
  createMcpHandler,
  acceptedContent,
  inputRequired,
  inputResponse,
  type CacheHint,
  type CallToolResult,
  type ContentBlock,
  type InputRequiredResult,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { runAnalysis, type AnalyzeDecisions } from "./analyze";
import { demoById } from "../app/demos";
import { diagnosticCatalog } from "../diagnostics/catalog";
import { explainCode } from "./explain";
import { SERVER_NAME, TOOL_NAMES } from "./info";
import type { McpDeps } from "./ports";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";
import {
  AnalyzeInputSchema,
  AnalyzeToolOutputSchema,
  type AnalyzeDeclined,
  entryAnswerSchema,
  ExplainInputSchema,
  ExplainOutputSchema,
  FragmentsAnswerSchema,
} from "./schemas";
import { analyzeStateCodec, type AnalyzeState } from "./state";
import { demoUri, diagnosticUri } from "./uris";

/** Which round this is, read from a retried request's `inputResponses` for one elicitation key: did
 *  the client decline or cancel it (as opposed to accepting, or this key not being this round's
 *  question at all)? Checking both "entry" and "fragments" unconditionally on every entry is safe —
 *  `inputResponses` only ever carries the latest round's answers, and each round asks exactly one of
 *  the two, so at most one of these two checks is ever non-`undefined`. */
function declinedAction(view: ReturnType<typeof inputResponse>): "decline" | "cancel" | undefined {
  return view.kind === "elicit" && view.action !== "accept" ? view.action : undefined;
}

/** Declining or cancelling is a valid choice, not a tool failure — a normal result explaining the
 *  refusal (and how to get the same outcome without asking) beats `isError`. `analyze-document`
 *  declares an `outputSchema`, and the SDK requires `structuredContent` on every non-`isError` result
 *  (see `validateToolOutput` in the SDK), so the refusal carries `AnalyzeDeclinedSchema` — the other
 *  half of the tool's registered `AnalyzeToolOutputSchema` union — rather than omitting
 *  `structuredContent` or fabricating an empty analysis. */
function refusal(
  action: "decline" | "cancel",
  question: "entry" | "fragments",
  explanation: string,
): CallToolResult {
  const verb = action === "decline" ? "Declined" : "Cancelled";
  const declined: AnalyzeDeclined = { declined: { action, question } };
  return {
    content: [{ type: "text", text: `${verb}: ${explanation}` }],
    structuredContent: declined,
  };
}

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
      // Verifies + decodes the `requestState` the entry → fragment-consent MRTR chain mints (state.ts)
      // before any handler sees it — a tampered or expired token never reaches analyze-document.
      requestState: { verify: analyzeStateCodec.verify },
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
      outputSchema: AnalyzeToolOutputSchema,
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
    async (args, ctx): Promise<CallToolResult | InputRequiredResult> => {
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

      // Write-once: read whatever this round answered (or declined/cancelled) before doing anything
      // else, so re-entry never re-asks a question the client already answered.
      const entryAction = declinedAction(inputResponse(ctx.mcpReq.inputResponses, "entry"));
      if (entryAction !== undefined) {
        return refusal(
          entryAction,
          "entry",
          "no document was chosen as the entry point. Call again with exactly one document in " +
            "`documents[]` carrying `isEntry: true`.",
        );
      }
      const fragmentsAction = declinedAction(inputResponse(ctx.mcpReq.inputResponses, "fragments"));
      if (fragmentsAction !== undefined) {
        return refusal(
          fragmentsAction,
          "fragments",
          "document fragments were not enabled, so the document set was not loaded. Call again with " +
            '`config: { fragments: "root" }` (only fragments a reference points at directly) or ' +
            '`config: { fragments: "any" }` (also types fragments from interior references) to load ' +
            "it anyway.",
        );
      }

      // `args.documents` is the same on every round (the client resends the original `arguments`
      // verbatim on retry), so the entry candidates — and the schema `acceptedContent` validates
      // against — are stable across the whole flow without needing to be carried in `requestState`.
      const entryFilenames = args.documents?.map((d) => d.filename) ?? [];
      const entryAnswer =
        entryFilenames.length > 0
          ? acceptedContent(ctx.mcpReq.inputResponses, "entry", entryAnswerSchema(entryFilenames))
          : undefined;
      const fragmentsAnswer = acceptedContent(
        ctx.mcpReq.inputResponses,
        "fragments",
        FragmentsAnswerSchema,
      );
      const state = ctx.mcpReq.requestState<AnalyzeState>();
      const decisions: AnalyzeDecisions = {
        entry:
          entryAnswer?.entry ?? (state?.phase === "awaiting-fragments" ? state.entry : undefined),
        fragments: fragmentsAnswer?.fragments,
      };

      const result = await runAnalysis(deps, args, ctx.mcpReq.signal, onProgress, decisions);

      if (result.ok === "needs-input") {
        if (result.need.kind === "entry") {
          return inputRequired({
            inputRequests: {
              entry: inputRequired.elicit({
                message:
                  result.need.filenames.length === 1
                    ? "No document in this set is marked as the entry point. Confirm which one to " +
                      "analyze as the entry."
                    : `${result.need.filenames.length} documents in this set are marked as the ` +
                      "entry point. Which one should be analyzed as the entry?",
                requestedSchema: entryAnswerSchema(result.need.filenames),
              }),
            },
          });
        }
        return inputRequired({
          inputRequests: {
            fragments: inputRequired.elicit({
              message:
                "One of these documents is neither a complete OpenAPI description nor a recognized " +
                'JSON Schema document. "root" loads it only if a reference points at its root; ' +
                '"any" also types it from references to its interior. Enable document fragments to ' +
                "load it anyway?",
              requestedSchema: FragmentsAnswerSchema,
            }),
          },
          // Only mint `requestState` when there is something to carry forward: by the time this
          // round's answer comes back, `inputResponses` will hold only "fragments" — an "entry"
          // answer from an earlier round would be gone by then. A fragments-only flow (no entry
          // round ever ran) has nothing worth remembering, so it asks with `inputRequests` alone.
          ...(decisions.entry !== undefined && {
            requestState: await analyzeStateCodec.mint({
              phase: "awaiting-fragments",
              entry: decisions.entry,
            }),
          }),
        });
      }

      if (!result.ok) {
        return { content: [{ type: "text", text: result.message }], isError: true };
      }

      const catalog = diagnosticCatalog();
      const codes = [...new Set(result.structured.diagnostics.map((d) => d.code))];
      const links: ContentBlock[] = codes.map((code): ContentBlock => ({
        type: "resource_link",
        uri: diagnosticUri(code),
        name: catalog[code].title,
      }));
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
