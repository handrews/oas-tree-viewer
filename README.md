# OpenAPI Description Structure Viewer

_Produced by Henry Andrews using Claude Code._

The OpenAPI Description Structure Viewer is a browser tool that renders an
[OpenAPI Description](https://learn.openapis.org/glossary.html) (OAD) or JSON Schema as navigable
trees and draws its references as arcs between fields and their targets. It shows how a description
fits together and flags resolution and validation problems in place, each located by JSON Pointer and
source line.

It demonstrates the expected behavior rather than bundling or transforming the description, so tool
authors can compare it against their own implementations and document authors can inspect and debug
without leaving the browser. It works on a single document or an OAD split across many files;
multi-document handling is unusually complete — the case least well served by other tooling, and
where the viewer stands out — but the same inspection applies to a single file.

Live demo: <https://henryandrews.net/projects/oas/>

The UI is prototype-stage and under review; Arazzo and Overlays support is planned, and end-user
documentation will follow once the feature set settles.

## Features

- Renders every object, array, and scalar as a tree node labeled with its OAS type — one tree per
  document, side by side on a shared zoom/pan canvas.
- Resolves and draws every reference an OAS 3.1/3.2 description can express, within and across
  documents, on demand or all at once.
- Reports each reference as resolved, type-mismatch, broken, or external, and collects unresolved
  references, advisories, unreachable documents, and unvalidated schemas into a copy-pasteable issue
  report.
- Validates each document offline against the official OpenAPI schema, and 3.1/3.2 Schema Objects
  against the JSON Schema dialect they declare.
- Shows the JSON Pointer and source line for every node and finding.
- Keyboard-navigable and screen-reader-accessible; large single-file descriptions stay responsive.
- Runs entirely in the browser — nothing is uploaded.
- Exposes its diagnostics over a local [MCP server](docs/mcp.md), runnable via stdio or Streamable
  HTTP, or tried in-page at `/mcp`.

## Inputs

Load by file upload (with an optional retrieval URL), URL fetch, folder upload (a whole directory at
once, relative paths preserved), or a built-in demo:

- JSON or YAML, OpenAPI or standalone JSON Schema.
- One or more documents per OAD; the first is the entry document, and another can be promoted to it.
- Bare document fragments — a Path Item, a shared schema library — load with an opt-in setting.

| Input | Status |
| --- | --- |
| OpenAPI 3.2.x / 3.1.x / 3.0.x | Supported |
| OpenAPI 2.0 / Swagger | Not supported (not planned) |
| Standalone JSON Schema (draft-04 → 2020-12) | Supported where the dialect is recognized |

Behavior is keyed by OAS minor-release family (`3.0`, `3.1`, `3.2`); patch numbers are accepted but
not used for schema selection.

## References

The viewer resolves:

- `$ref` and `operationRef`
- Discriminator `mapping` values
- Security Requirement keys
- Link `operationId`
- `$dynamicRef` / `$dynamicAnchor` (2020-12)
- `$recursiveRef` / `$recursiveAnchor` (2019-09)
- draft-04/06/07 identifier-fragment references

Dynamic references point tentatively at every anchor they could resolve to at runtime.

## Errors

The viewer reports, on the offending document's row or above the form:

- Parse error — invalid JSON/YAML
- Unrecognized document — neither OpenAPI nor JSON Schema (loadable as a fragment)
- Schema-invalid — fails the official OpenAPI schema
- Version mismatch — the OAD mixes OAS versions
- Invalid Link — both `operationRef` and `operationId` set
- Duplicate `operationId`
- Too deeply nested — refused up front, with a Load anyway override

## Run locally

Requires Node.js (developed on v24) and npm.

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

Pick a built-in demo or add your own documents and click Render OAD. Sample OADs live in
[`public/fixtures/`](public/fixtures).

## MCP server

The same diagnostics the issue report shows are exposed over a local
[MCP](https://modelcontextprotocol.io) server — two tools (`analyze-document`, `explain-diagnostic`),
a diagnostic/demo resource catalog, and two prompts:

```bash
npm run build:mcp   # builds dist-mcp/stdio.mjs + dist-mcp/http.mjs
npm run mcp          # serve over stdio (for Claude Code, Claude Desktop, the Inspector)
npm run mcp:http     # serve Streamable HTTP on 127.0.0.1 (binds loopback only)
npm run mcp:inspect  # launch the MCP Inspector against the stdio server
```

Both tools are read-only (`openWorldHint: false`) and never fetch a URL — input is a bundled demo id
or document text supplied inline in the call, and nothing else. There is no public endpoint; the
deployed site serves the `/mcp` page, which runs the server in-page. See
[docs/mcp.md](docs/mcp.md) for the full tool/resource/prompt reference, host configuration, and the
security model.

## Not yet implemented

- OAS 2.0 (Swagger) support (not planned)
- Search / filter

## Documentation

- [docs/architecture.md](docs/architecture.md) — how the viewer is built.
- [docs/mcp.md](docs/mcp.md) — the MCP server: tools, resources, prompts, and how to connect a host.
- [CONTRIBUTING.md](CONTRIBUTING.md) — tests, quality gates, and the release process.
- [CHANGELOG.md](CHANGELOG.md) — release history.
