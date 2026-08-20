// The live, in-page host: a real McpHandler (server.ts) served in-process — no network hop — and a
// real Client talking to it over StreamableHTTPClientTransport. The transport's `fetch` is wrapped to
// log every exchange the wire log shows: request headers, the JSON-RPC body, the response
// status/headers, and either the parsed JSON body or the decoded SSE frames in order.
//
// `res.body.tee()` splits the response body into two identical streams — `live` goes back to the
// transport unmodified (so the client stays fully functional) and `copy` is drained here for the log.
// Excluded from coverage (see vitest.config.ts): this is live browser wiring, exercised in
// test/browser/mcpBrowserHost.svelte.test.ts and e2e/mcp.spec.ts, not node-testable — mirroring why
// pipelineClient.ts is excluded.
//
// `beginAction` stamps every exchange from here until the next call with a caller-supplied label —
// what WireLog.svelte groups by. It is a plain field, not per-request bookkeeping: an elicitation
// retry happens inside the same `client.callTool()` the page already labeled, with no intervening
// `beginAction` call, so the retry shares its originating call's label for free — exactly the pairing
// the MRTR demo needs.

import {
  Client,
  StreamableHTTPClientTransport,
  type ElicitResult,
} from "@modelcontextprotocol/client";
import { createHandler } from "../server";
import { browserFixtures } from "../fixtures.browser";
import { CONNECT_ACTION } from "../info";

/** One decoded SSE frame (`event:`/`data:` lines up to the blank-line separator). */
export interface WireFrame {
  event?: string;
  data: string;
}

/** The restricted wire shape these two elicitations ever send: a flat string/string-enum object —
 *  matches `ElicitPanel.svelte`'s own prop type, since that is the only renderer this ever reaches. */
export interface ElicitFormSchema {
  properties: Record<string, { type?: string; enum?: readonly string[]; title?: string }>;
  required?: string[];
}

/** One outstanding `elicitation/create` request, held here until `ElicitPanel.svelte` calls
 *  `respond` — which is what turns the client's declared `elicitation` capability into a second,
 *  visibly distinct `tools/call` exchange in the wire log. */
export interface PendingElicit {
  message: string;
  requestedSchema: ElicitFormSchema;
  respond(result: ElicitResult): void;
}

/** One request/response exchange on the wire, as shown by WireLog.svelte. */
export interface WireExchange {
  id: number;
  method: string;
  /** The user action that caused this exchange (see `beginAction`); `CONNECT_ACTION` before the
   *  first one. */
  action: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  status: number;
  responseHeaders: Record<string, string>;
  contentType: string | null;
  /** Set once the response body is drained, for an `application/json` response. */
  json?: unknown;
  /** Set once the response body is drained, for a `text/event-stream` response — in arrival order. */
  frames: WireFrame[];
  /** True until the response body has finished draining. */
  pending: boolean;
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => (record[key] = value));
  return record;
}

/** Split a fully-drained SSE body into its frames, in arrival order. */
function parseFrames(raw: string): WireFrame[] {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      let event: string | undefined;
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice("event:".length).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
      }
      return { event, data: dataLines.join("\n") };
    });
}

/**
 * Connects a real Client to a real McpHandler with no network hop, calling `onWireLog` with a fresh
 * snapshot of the exchange log after every request and every response-body drain — so a caller
 * (a `$state` array in McpPage.svelte) can just assign it.
 */
export class McpBrowserHost {
  private readonly handler = createHandler({ fixtures: browserFixtures, version: __APP_VERSION__ });
  private readonly onWireLog: (exchanges: WireExchange[]) => void;
  private readonly onElicit?: (pending: PendingElicit | null) => void;
  private exchanges: WireExchange[] = [];
  private nextId = 1;
  private currentAction: string = CONNECT_ACTION;

  readonly client: Client;
  readonly connected: Promise<void>;

  /** `onElicit` is optional: a caller that never triggers the fragment-consent / ambiguous-entry
   *  elicitations (e.g. the existing demo-only specs) has nothing to render one with, so an
   *  unanswerable request is declined immediately rather than left hanging. */
  constructor(
    onWireLog: (exchanges: WireExchange[]) => void,
    onElicit?: (pending: PendingElicit | null) => void,
  ) {
    this.onWireLog = onWireLog;
    this.onElicit = onElicit;
    const transport = new StreamableHTTPClientTransport(new URL("https://oas-mcp.invalid/mcp"), {
      fetch: this.fetch,
    });
    this.client = new Client(
      { name: "oas-structure-viewer-demo", version: __APP_VERSION__ },
      {
        versionNegotiation: { mode: "auto" },
        // Declares the capability analyze-document's two elicitations need — without it the server
        // rejects the embedded request (-32021) before an `input_required` result ever comes back —
        // and caps the auto-fulfilment driver at this flow's real depth (entry, then fragments).
        capabilities: { elicitation: { form: {} } },
        inputRequired: { maxRounds: 3 },
      },
    );
    this.connected = this.client.connect(transport);
    this.client.setRequestHandler("elicitation/create", (request) => {
      return new Promise<ElicitResult>((resolve) => {
        const respond = (result: ElicitResult): void => {
          this.onElicit?.(null);
          resolve(result);
        };
        // URL-mode elicitation is a real part of the spec but not one either of this server's two
        // elicitations use, and ElicitPanel only renders a form — cancel rather than hang.
        if (!this.onElicit || request.params.mode === "url") {
          respond({ action: "cancel" });
          return;
        }
        this.onElicit({
          message: request.params.message,
          requestedSchema: request.params.requestedSchema,
          respond,
        });
      });
    });
  }

  /** Labels every wire exchange from here until the next call — see the file header. */
  beginAction(label: string): void {
    this.currentAction = label;
  }

  private replace(exchange: WireExchange): void {
    this.exchanges = this.exchanges.map((e) => (e.id === exchange.id ? exchange : e));
    this.onWireLog(this.exchanges);
  }

  private fetch: typeof fetch = async (url, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { method?: string }) : {};
    let exchange: WireExchange = {
      id: this.nextId++,
      method: body.method ?? "?",
      action: this.currentAction,
      url: String(url),
      requestHeaders: headerRecord(init?.headers),
      requestBody: body,
      status: 0,
      responseHeaders: {},
      contentType: null,
      frames: [],
      pending: true,
    };
    this.exchanges = [...this.exchanges, exchange];
    this.onWireLog(this.exchanges);

    const res = await this.handler.fetch(new Request(url, init));
    const contentType = res.headers.get("content-type");
    exchange = {
      ...exchange,
      status: res.status,
      responseHeaders: headerRecord(res.headers),
      contentType,
    };
    this.replace(exchange);

    if (!res.body) {
      this.replace({ ...exchange, pending: false });
      return res;
    }

    const [live, copy] = res.body.tee();
    const isSse = contentType?.includes("text/event-stream") ?? false;
    void new Response(copy).text().then((text) => {
      this.replace(
        isSse
          ? { ...exchange, frames: parseFrames(text), pending: false }
          : { ...exchange, json: text ? JSON.parse(text) : undefined, pending: false },
      );
    });

    return new Response(live, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };

  async close(): Promise<void> {
    await this.connected;
    await this.client.close();
    await this.handler.close();
  }
}
