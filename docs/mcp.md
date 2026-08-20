# MCP server

The viewer ships a demo [MCP](https://modelcontextprotocol.io) server over `src/mcp/` that exposes
the same unified `Diagnostic[]` model the issue report and canvas glyphs already read (see
[docs/architecture.md](architecture.md#unified-diagnostics)). It is a self-contained demo of MCP
against this viewer's existing diagnostics — no new analysis, one server module served by two local
hosts and an in-page one.

Built against MCP's **2026-07-28** revision, on SDK v2
(`@modelcontextprotocol/{server,client,node}@2`). That revision removes the `initialize` handshake —
every request carries its protocol version, client info, and capabilities in `_meta` — and replaces
server-initiated requests with **Multi Round-Trip Requests (MRTR)**: instead of the server pushing a
request at the client, a tool call returns `resultType: "input_required"` and the client answers on a
retry with a new request id. See [MRTR](#multi-round-trip-requests-mrtr) below.

## Tools

Both tools are read-only and never fetch a URL:

```json
"annotations": {
  "readOnlyHint": true,
  "destructiveHint": false,
  "idempotentHint": true,
  "openWorldHint": false
}
```

`openWorldHint: false` is the honest encoding of that constraint — every input is either a bundled
demo id or document text supplied inline in the call. See [Security model](#security-model).

### `analyze-document`

Loads an OAD (one or more OpenAPI/JSON Schema documents) and returns its diagnostics: unresolved or
mismatched references, reference advisories, resolution caveats, unreachable documents, and
unvalidated Schema Objects — the same findings the viewer's issue report shows.

Input, mirroring `ViewerConfig` field-for-field:

| Field | Type | Notes |
| --- | --- | --- |
| `demo` | `string` | A bundled demo id. Mutually exclusive with `documents`. |
| `documents` | array of `{filename, text, retrievalUri?, isEntry}` | Inline document set, capped at 20 documents / 1,000,000 characters each. |
| `config` | `{mappingPrecedence?, componentLookup?, fragments?}` | Overrides `defaultConfig`. A demo's own config partial (if any) is only a *default* on top of that — this field, when given, overrides the demo's default in turn. |
| `minSeverity` | `"error" \| "warning" \| "info"` | Default `"info"`. |

Calling it against the `refs` demo:

```json
// tools/call { "name": "analyze-document", "arguments": { "demo": "refs" } }
{
  "content": [
    {
      "type": "text",
      "text": "OAS Structure Viewer — issue report\nEntry document: refs-3.1.yaml\n\nUnresolved references (4):\n  [type-mismatch] refs-3.1.yaml #/paths/~1links/get/parameters/1 (line 17)\n      $ref: #/components/schemas/Thing\n      expected Parameter, found Schema\n  [broken] refs-3.1.yaml #/paths/~1links/get/parameters/2 (line 19)\n      $ref: #/components/parameters/Missing\n      target not found (the fragment names nothing)\n  [external] refs-3.1.yaml #/paths/~1links/get/parameters/3 (line 21)\n      $ref: https://elsewhere.example/api.yaml#/components/parameters/Foo\n      external document not loaded\n  [type-mismatch] refs-3.1.yaml #/paths/~1links/get/responses/200/links/wrong (line 36)\n      operationRef: #/components/schemas/Thing\n      expected Operation, found Schema"
    },
    { "type": "resource_link", "uri": "oas://diagnostic/ref-type-mismatch", "name": "Reference type mismatch" },
    { "type": "resource_link", "uri": "oas://diagnostic/ref-broken", "name": "Unresolved reference" },
    { "type": "resource_link", "uri": "oas://diagnostic/ref-external", "name": "External reference not loaded" },
    { "type": "resource_link", "uri": "oas://demo/refs", "name": "Broken & external references (3.1)" }
  ],
  "structuredContent": {
    "entry": "refs-3.1.yaml",
    "versionFamily": "3.1",
    "documents": [
      { "index": 0, "label": "refs-3.1.yaml", "kind": "openapi", "oasVersion": "3.1.0", "isEntry": true },
      { "index": 1, "label": "refs-shared-3.1.yaml", "kind": "openapi", "oasVersion": "3.1.0", "isEntry": false }
    ],
    "counts": { "total": 4, "error": 3, "warning": 1, "info": 0 },
    "sections": [{ "id": "unresolved", "label": "Unresolved references", "count": 4 }],
    "diagnostics": [
      {
        "code": "ref-type-mismatch",
        "title": "Reference type mismatch",
        "severity": "error",
        "defaultSeverity": "error",
        "source": "reference",
        "section": "unresolved",
        "message": "expected Parameter, found Schema",
        "location": {
          "documentIndex": 0,
          "document": "refs-3.1.yaml",
          "pointer": "/paths/~1links/get/parameters/1",
          "displayPointer": "#/paths/~1links/get/parameters/1",
          "line": 17,
          "column": 11
        },
        "relatedLocations": [
          {
            "documentIndex": 0,
            "document": "refs-3.1.yaml",
            "pointer": "/components/schemas/Thing",
            "displayPointer": "#/components/schemas/Thing",
            "line": 40,
            "column": 7
          }
        ],
        "ref": { "kind": "$ref", "refString": "#/components/schemas/Thing" },
        "catalogUri": "oas://diagnostic/ref-type-mismatch"
      }
      // … three more diagnostics, same shape
    ]
  }
}
```

`content[0].text` is `formatIssueReport` verbatim — the same text the viewer's Copy button produces
— followed by one `resource_link` per distinct code present and, when `demo` was used, one to the
demo itself. `structuredContent` keeps both `severity` (what this run emitted) and `defaultSeverity`
(the catalog's policy for the code) so a caller can tell "suppressed by `minSeverity`" apart from
"the catalog turned this code down."

`location.documentIndex` and `location.document` are a **stable index and label**, never the
engine's internal `docId` — see [why `docId` never reaches the wire](architecture.md#mcp-server).

### `explain-diagnostic`

Looks up one diagnostic code in the catalog (`content/diagnostics.yaml`): title, description,
default severity, and which issue-report section it belongs to.

```json
// tools/call { "name": "explain-diagnostic", "arguments": { "code": "ref-broken" } }
{
  "content": [
    { "type": "text", "text": "Unresolved reference\n\nThe reference's target resource was found, but the fragment names nothing in it." },
    { "type": "resource_link", "uri": "oas://diagnostic/ref-broken", "name": "Unresolved reference" }
  ],
  "structuredContent": {
    "code": "ref-broken",
    "title": "Unresolved reference",
    "description": "The reference's target resource was found, but the fragment names nothing in it.",
    "defaultSeverity": "error",
    "enabled": true,
    "section": "unresolved",
    "catalogUri": "oas://diagnostic/ref-broken"
  }
}
```

Input is `z.enum(DIAGNOSTIC_CODES)` (14 codes: 3 reference-resolution statuses, 6 reference
advisories, 3 node-level resolution caveats, 2 document-level findings), so `tools/list` advertises
every valid code and an unknown one is rejected by the SDK before the handler runs.

## Resources

Scheme `oas:`. Two static resources, three templates — all four `list` callbacks enumerate a bounded
set (14 diagnostic codes, 12 demos and their fixed document sets), so nothing here needs
`list: undefined`:

| URI | Kind | Content |
| --- | --- | --- |
| `oas://catalog/diagnostics` | static | the whole diagnostic catalog, keyed by code |
| `oas://catalog/demos` | static | all 12 bundled demos with their documents |
| `oas://diagnostic/{code}` | template, listable | one catalog entry as Markdown |
| `oas://demo/{demoId}` | template, listable | one demo's manifest (documents, `isEntry`, `retrievalUri`) |
| `oas://demo/{demoId}/{filename}` | template, listable | that document's raw fixture text |

`resources/list` enumerates **53** resources: the 2 statics, 14 diagnostics, 12 demo manifests, and
25 individual demo documents.

```json
// resources/read { "uri": "oas://diagnostic/ref-broken" }
{
  "contents": [
    {
      "uri": "oas://diagnostic/ref-broken",
      "mimeType": "text/markdown",
      "text": "# Unresolved reference\n\nThe reference's target resource was found, but the fragment names nothing in it.\n\nDefault severity: error\n"
    }
  ]
}
```

```json
// resources/read { "uri": "oas://demo/refs" }
{
  "contents": [
    {
      "uri": "oas://demo/refs",
      "mimeType": "application/json",
      "text": "{\"id\":\"refs\",\"label\":\"Broken & external references (3.1)\",\"description\":\"A two-document OAD that exercises every reference outcome (resolved, type-mismatch, broken, and external) to demonstrate the issue report and various warning and error indicators.\",\"config\":{},\"documents\":[{\"filename\":\"refs-3.1.yaml\",\"isEntry\":true,\"retrievalUri\":\"https://example.com/oad/entry.yaml\"},{\"filename\":\"refs-shared-3.1.yaml\",\"isEntry\":false,\"retrievalUri\":\"https://example.com/oad/shared.yaml\"}]}"
    }
  ]
}
```

Every list/read response here carries a cache hint — `tools/list`, `prompts/list`,
`resources/list`, `resources/templates/list`, and `resources/read` all answer with
`"ttlMs": 3600000, "cacheScope": "public"`. All five are build-time-static and identical for every
caller, so `"public"` is honest.

### Completion

`completion/complete` covers `{code}`, `{demoId}`, and `{filename}` — the last scoped by the
already-chosen `{demoId}`, using the two-argument completion form, so completing a filename only
offers documents that demo actually has:

```json
// completion/complete, ref oas://demo/{demoId}/{filename}, argument "filename" = "",
// context.arguments.demoId = "refs"
{ "completion": { "values": ["refs-3.1.yaml", "refs-shared-3.1.yaml"], "total": 2, "hasMore": false } }
```

With no `demoId` in context, `{filename}` completes to `[]` — there is nothing to scope against.

## Prompts

Two prompts, surfaced directly to a person (a slash command or menu entry), not something the model
picks on its own:

- **`review-oad`** (args `demo`, `focus`, both completable) — seeds a message that calls
  `analyze-document` and summarizes one issue-report section.
- **`explain-issue-report`** (arg `report`) — turns a pasted issue report (the viewer's Copy button
  output) into a triage plan.

```json
// prompts/get { "name": "review-oad", "arguments": { "demo": "refs", "focus": "unresolved" } }
{
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "Call analyze-document with { \"demo\": \"refs\" }, then summarize the \"unresolved\" section of the result: what it contains, and what I should do about it."
      }
    }
  ]
}
```

## Progress and streaming

`analyze-document` reports one progress step per document it reads, plus three fixed steps
(resolve, run the pipeline, join the catalog) — real work this module does, not synthetic ticks:

```json
[
  { "progress": 1, "total": 5, "message": "resolving demo \"refs\"" },
  { "progress": 2, "total": 5, "message": "read refs-3.1.yaml (1,755 bytes)" },
  { "progress": 3, "total": 5, "message": "read refs-shared-3.1.yaml (685 bytes)" },
  { "progress": 4, "total": 5, "message": "running load → validate → resolve → diagnose" },
  { "progress": 5, "total": 5, "message": "collecting 4 diagnostics" }
]
```

`runPipeline` itself is a single `await` with no callback seam (see
[architecture.md](architecture.md#mcp-server)), so no per-stage progress exists inside it — every
notification above is emitted around it, not faked by timer.

Progress is only wired when the caller supplies a `progressToken`; an unrequested notification would
upgrade the response for no reason. Because the SDK upgrades a response to `text/event-stream` the
moment the **first** notification is sent — before the result — this happens automatically, with no
`responseMode` pinned. That produces a deliberate contrast between the two tools:

| Tool | Progress | Response `Content-Type` |
| --- | --- | --- |
| `analyze-document` | yes (docs + 3 steps) | `text/event-stream` |
| `explain-diagnostic` | none | `application/json` |

Confirmed against a live HTTP call: the same `Client`, two `tools/call`s, two different content
types, with no configuration difference between them beyond what each tool actually does.

`ctx.mcpReq.signal` is wired alongside progress: checked between document reads and before
`runPipeline` runs, so a cancelled call stops promptly rather than finishing a load nobody wants.

## Multi round-trip requests (MRTR)

Two genuinely necessary triggers — no theater. Both are preconditions the server cannot resolve on
its own, mirroring choices the app's own Configure page already asks a person to make.

**Fragment consent.** A document that is neither a complete OpenAPI description nor a recognized
JSON Schema document loads only if `config.fragments` is widened from its `"none"` default. Rather
than silently retrying with a looser setting, the tool elicits the choice — `"none"` / `"root"` /
`"any"` — exactly mirroring the Configure page's own **Document types** selector; both read their
wording from the same module (`src/app/fragmentsText.ts`), which is also where the elicitation's
`requestedSchema` gets its `title`/`description`.

**Ambiguous entry document.** Inline `documents[]` with zero or more than one `isEntry: true` elicits
which filename is the entry, since `assembleOad` requires exactly one.

A round trip looks like this — first, the server's `input_required` result:

```json
{
  "mode": "form",
  "message": "One of these documents is neither a complete OpenAPI description nor a recognized JSON Schema document. Under \"Document types\": \"root\" loads a fragment only if a reference points at its root; \"any\" also types a fragment from references to its interior, tolerating one left unreferenced. Widen it to load this document anyway?",
  "requestedSchema": {
    "type": "object",
    "properties": {
      "fragments": {
        "type": "string",
        "title": "Document types",
        "description": "Whether to load fragmentary documents (neither a complete OpenAPI document nor a recognized JSON Schema document): \"none\" refuses a fragment entirely; \"root\" loads a fragment only if a reference points at its root; \"any\" also types a fragment from references to its interior, tolerating one left unreferenced.",
        "enum": ["none", "root", "any"]
      }
    },
    "required": ["fragments"]
  }
}
```

Then the client retries with a new JSON-RPC id, carrying `inputResponses.fragments` — and, if this
is the second question in a chain, the opaque `requestState` the first round minted. Accepting
`{ "fragments": "root" }` for the fragment-consent example above yields:

```json
// tools/call retry, inputResponses: { fragments: { action: "accept", content: { fragments: "root" } } }
{
  "content": [{ "type": "text", "text": "OAS Structure Viewer — issue report\nEntry document: entry.yaml\n\nNo issues found." }],
  "structuredContent": {
    "entry": "entry.yaml",
    "versionFamily": "3.0",
    "documents": [
      { "index": 0, "label": "entry.yaml", "kind": "openapi", "oasVersion": "3.0.4", "isEntry": true },
      { "index": 1, "label": "pathitem.yaml", "kind": "fragment", "isEntry": false }
    ],
    "counts": { "total": 0, "error": 0, "warning": 0, "info": 0 },
    "sections": [],
    "diagnostics": []
  }
}
```

Declining or cancelling is a valid outcome, not a tool failure: the reply is a normal (non-`isError`)
result naming the config argument that would answer the same question up front —
`config: { fragments: "root" }` or `config: { fragments: "any" }` for the fragment case, or a single
`isEntry: true` document for the entry case.

`requestState` carries **decisions only, never document payload** — the client echoes it back
verbatim, inline document text can be megabytes, and the retry re-sends the original `arguments`
anyway, so there is nothing a state token could carry that the retry doesn't already have. It is
HMAC-sealed with a TTL (`src/mcp/state.ts`), so a tampered or expired token never reaches the tool
handler.

A demo's own `config` partial is only a *default*: `{ demo: "fragment" }` alone loads cleanly (the
demo's own `fragments: "root"` applies), but an explicit `config` in the call overrides it —
`{ demo: "fragment", config: { fragments: "none" } }` genuinely elicits, the same question a caller
would hit sending the fragment demo's documents inline with no `config` at all. `/mcp` reaches this
the ordinary way: the page seeds the arguments form's `config` from whatever's on screen (the current
view, or the URL's own config on a cold load), so calling `analyze-document` against the fragment demo
with its default (strict) config — no demo-picking tricks, no dedicated fixture — reaches the
elicitation directly, and the same happens for any real document set that turns out to need fragments
enabled, once "Try it over MCP" gets it there.

## Security model

Both tools are read-only with `openWorldHint: false`: input is a bundled demo id or document text
supplied in the call, and nothing here ever fetches a URL, writes a file, or shells out.

The local HTTP host (`hosts/http.ts`, `npm run mcp:http`) binds `127.0.0.1` only and validates both
`Host` and `Origin` in front of the handler — the handler itself validates neither:

```
$ curl -i -X POST http://127.0.0.1:3939/mcp -H 'Host: evil.example' ...
HTTP/1.1 403 Forbidden
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host: evil.example"},"id":null}

$ curl -i -X POST http://127.0.0.1:3939/mcp -H 'Origin: https://evil.example' ...
HTTP/1.1 403 Forbidden
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Origin: evil.example"},"id":null}
```

On a loopback bind, the `Host` check is what stops DNS rebinding. The revision's header/body
agreement check is enforced independently of both: a `tools/call` whose `Mcp-Name` header disagrees
with `params.name` in the body is rejected before the handler runs —

```
$ curl ... -H 'Mcp-Name: wrong-tool-name' -d '{"...","params":{"name":"explain-diagnostic",...}}'
HTTP/1.1 400 Bad Request
{"jsonrpc":"2.0","error":{"code":-32020,"message":"Bad Request: the request headers and body disagree: the body carries params.name=\"explain-diagnostic\" but the Mcp-Name header names \"wrong-tool-name\""},"id":1}
```

— which is the revision's header-validation requirement working end to end, not a hand-rolled check.

There is **no public endpoint**: the deployed site at
<https://henryandrews.net/projects/oas/> serves the `/mcp` page, which runs the server in-page with
no network hop (`hosts/browser.ts`) — it does not expose a reachable server. Connecting an external
host means running one locally, over stdio or `mcp:http`, on your own machine.

The page itself is a two-column workbench on wide screens: calling a tool and its result sit on the
left, a sticky wire log tracks every exchange on the right — grouped by the action that caused it, so
a call and any MRTR retry it triggers read as one group — and the full capability list collapses under
a `<details>` at the bottom, out of the way until asked for. Below the viewer's usual breakpoint it
drops to a single column in the same source → call → result → wire log → capabilities order.

### Deliberately unused

Roots, Sampling, and Logging are all deprecated in the 2026-07-28 revision and are not registered.
The HTTP+SSE transport (the older two-endpoint SSE transport) is not served — only Streamable HTTP.
And the revision drops sessions: there is no session id, no GET stream, and no `Last-Event-ID`
resumability to implement, since `createMcpHandler`'s factory constructs a fresh `McpServer` per
request.

## Running the server

```bash
npm run build:mcp   # builds dist-mcp/stdio.mjs + dist-mcp/http.mjs (vite.mcp.config.ts)
npm run mcp          # build, then serve over stdio
npm run mcp:http     # build, then serve Streamable HTTP on 127.0.0.1:3939
npm run mcp:inspect  # build, then launch the MCP Inspector against the stdio server
```

`mcp:http` reads `PORT` (default `3939`). Both process entries log their readiness banner to
**stderr**, keeping stdout clean for the stdio JSON-RPC channel.

### Claude Code

Add a project-scoped server (`.mcp.json` at the repo root, or `claude mcp add`):

```json
{
  "mcpServers": {
    "oas-structure-viewer": {
      "command": "node",
      "args": ["/absolute/path/to/oas-tree-viewer/dist-mcp/stdio.mjs"]
    }
  }
}
```

```bash
claude mcp add oas-structure-viewer -- node /absolute/path/to/oas-tree-viewer/dist-mcp/stdio.mjs
```

Build first (`npm run build:mcp`) — the host launches the built `.mjs`, not the TypeScript source.

### Claude Desktop

Add the same shape to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "oas-structure-viewer": {
      "command": "node",
      "args": ["/absolute/path/to/oas-tree-viewer/dist-mcp/stdio.mjs"]
    }
  }
}
```

### MCP Inspector

```bash
npm run mcp:inspect
```

Opens the [Inspector](https://github.com/modelcontextprotocol/inspector) against the stdio server —
useful for browsing the resource catalog, trying completion, and driving a `tools/call` by hand
without writing a client.
