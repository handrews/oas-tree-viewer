# OpenAPI Description Structure Viewer

Produced by Henry Andrews using Claude Code.

The OpenAPI Description Structure Viewer loads an OpenAPI Description or standalone JSON Schema document
and renders its parsed structure as navigable trees. It is designed for inspecting multi-document OpenAPI
Descriptions, reference behavior, source locations, and validation or resolution issues.

The viewer does not bundle or transform an OpenAPI Description into a resolved output. It shows the
document structure and relationships so authors and tool developers can compare expected behavior with
what other tools do.

## Features

- Load documents by file upload, folder upload, URL, or built-in demo.
- Render one collapsible tree per document, with the entry document first.
- Navigate the tree with mouse, keyboard, or detail-panel links.
- Show source JSON Pointers, source lines, OAS/JSON Schema type labels, base URIs, and reference targets.
- Resolve references across loaded documents and draw selected or all reference arcs.
- Report broken, external, type-mismatched, advisory, unreachable, and unvalidated-schema findings.
- Validate OpenAPI documents and JSON Schema documents offline with bundled schemas.
- Run parsing, validation, resolution, and diagnostics in a cancellable Web Worker.
- Window large trees so only visible rows are mounted.

## Supported Inputs

| Input | Status |
| --- | --- |
| OpenAPI 3.2.x | Supported |
| OpenAPI 3.1.x | Supported |
| OpenAPI 3.0.x | Supported |
| OpenAPI 2.0 / Swagger | Not supported |
| Standalone JSON Schema draft-04 through 2020-12 | Supported where the dialect is recognized |
| OpenAPI document fragments | Optional, configurable support |

The implementation selects OpenAPI behavior by minor release family (`3.0`, `3.1`, `3.2`). OAS patch
releases do not introduce schema-impacting changes, so patch numbers are accepted but not used for schema
selection.

## Reference Support

The viewer resolves:

- `$ref` in Reference, Path Item, and Schema contexts.
- `operationRef`.
- Link `operationId`.
- Discriminator mapping values.
- Security Requirement keys.
- `$dynamicRef` / `$dynamicAnchor`.
- `$recursiveRef` / `$recursiveAnchor`.
- Draft-04/06/07 identifier-fragment references.

Resolution results are shown as resolved, broken, external, type-mismatched, or advisory. Unsupported or
unknown JSON Schema dialects still render with a warning and best-effort reference behavior.

## Not Yet Implemented

- Search/filter.
- Arazzo and Overlays.
- OpenAPI 2.0 support.

## Requirements

- Node.js 24.
- npm.

## Run Locally

```bash
npm install
npm run dev
```

The Vite dev server runs at <http://localhost:5173>.

Useful sample documents are available under `public/fixtures/` and can be loaded from the dev server with
URLs such as `/fixtures/petstore-3.1.yaml`.

## Build and Test

```bash
npm run lint
npm run format:check
npm run typecheck
npm run coverage
npm run e2e
npm run build
```

`npm run coverage` runs the Vitest unit and browser projects and enforces coverage thresholds.
`npm run e2e` runs Playwright tests, including axe accessibility checks.

## Documentation

- Contributor workflow and release process: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Internal architecture: [`docs/architecture.md`](docs/architecture.md)
- User-visible release history: [`CHANGELOG.md`](CHANGELOG.md)
