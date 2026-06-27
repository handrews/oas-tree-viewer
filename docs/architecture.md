# Architecture

This document describes how the OpenAPI Description Structure Viewer is organized internally. It is
intended for contributors changing behavior, not for users running the app.

## Runtime Shape

The app has two pages:

- Configure: collects uploaded files, folders, URLs, or built-in demos.
- Explore: renders the loaded description and its reference graph.

The expensive load pipeline runs in a Web Worker:

1. Fetch or read document text.
2. Parse JSON/YAML.
3. Build a JSON Pointer-addressed tree.
4. Classify nodes by OpenAPI/JSON Schema role.
5. Validate against the appropriate OpenAPI and JSON Schema dialect schemas.
6. Resolve references and reference-like relationships.
7. Build diagnostics.

The main thread receives plain cloneable data and renders it through Svelte plus an imperative D3/SVG
tree canvas.

## Module Map

| Area | Files |
| --- | --- |
| Types and errors | `src/types.ts`, `src/errors.ts`, `src/limits.ts` |
| Parsing | `src/parse/detectFormat.ts`, `src/parse/positions.ts` |
| Tree model | `src/model/treeBuilder.ts`, `src/model/jsonPointer.ts` |
| OAS classification | `src/oas/descriptor.ts`, `src/oas/classify.ts`, `src/oas/dialects.ts` |
| Loading and assembly | `src/loader.ts`, `src/oad.ts` |
| Validation | `src/validation/validateOad.ts` |
| Reference resolution | `src/refs/*` |
| Diagnostics | `src/diagnostics/*`, `content/diagnostics.yaml` |
| Connection styling | `src/connections/*`, `content/connections.yaml` |
| Rendering | `src/render/*` |
| App shell and routing | `src/app/*`, `src/pages/*`, `src/ui/*` |

## Core Model

Every loaded document has:

- A stable document id.
- A root `TreeNode`.
- A base URI derived from `$self`, retrieval URI, or a synthetic file URI.
- Source positions keyed by JSON Pointer where available.

Every tree node has:

- A JSON Pointer id.
- Structural value information.
- Optional OAS classification.
- Optional reference metadata.

Reference resolution returns `ReferenceEdge` values and indexes them by source and target. Diagnostics
are a separate flat model so the issue report, detail panel, and canvas warning glyphs read from the same
source.

## OpenAPI Version Handling

The implementation keys behavior by OpenAPI minor release family: `3.0`, `3.1`, or `3.2`. Patch releases
share the same schema-impacting behavior within a minor line, so patch numbers are accepted but not used
for schema selection.

OpenAPI 3.0 Schema Objects are handled as OAS-specific schema objects. OpenAPI 3.1 and 3.2 Schema Objects
are handled as JSON Schema and may change dialect with `$schema`.

## Reference Resolution

`src/refs/resolver.ts` orchestrates resolution. The resolver-specific modules are:

- `indexer.ts`: document/resource/anchor indexes and reference-source collection.
- `uriRef.ts`: URI-reference target lookup and type check.
- `componentRef.ts`: Discriminator mapping and Security Requirement component-or-URI rules.
- `operationId.ts`: Link `operationId` indexing and lookup.
- `dynamicRef.ts`: `$dynamicRef` / `$recursiveRef` classification and fan-out.
- `scopeGraph.ts`: reachability and resource-transition graph construction for dynamic scope.

The resolver covers:

- `$ref` in Reference, Path Item, and Schema contexts.
- `operationRef`.
- Link `operationId`.
- Discriminator mapping values.
- Security Requirement keys.
- `$dynamicRef` / `$dynamicAnchor`.
- `$recursiveRef` / `$recursiveAnchor`.
- Draft-04/06/07 identifier-fragment references.

Reference targets are checked against the expected slot type. Resolved, broken, external, and type-mismatch
outcomes are represented as edge status rather than rendered directly by the resolver.

## Rendering

The canvas is an imperative D3/SVG island wrapped by Svelte. Svelte owns page state and component
composition; the canvas owns zooming, panning, row rendering, reference arcs, keyboard focus, and
windowing.

Large trees are windowed. Only rows near the viewport are mounted; layout for off-screen rows is tracked
analytically.

## Data-Driven Policy

Several user-visible policies are data files:

- `content/demos.yaml`: built-in demos.
- `content/diagnostics.yaml`: diagnostic severity, titles, and descriptions.
- `content/connections.yaml`: connection line, marker, and arrow styles.

Changing these files should not require code changes unless the vocabulary itself changes.
