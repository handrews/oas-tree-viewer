# OAS Structure Viewer

A TypeScript web app that reads an **OpenAPI Description (OAD)** and renders its parsed
structure as collapsible **indented trees** — every object, array, and scalar shown as a
row, with each node labeled by its OpenAPI Specification (OAS) type — and resolves
references, drawing them as **on-demand arcs** between the referencing field and its target
(including across documents).

## What it does

- Loads an OAD made of **one or more documents**: the **first document is the entry
  document**, any others are additional (referenced) documents. Each document is loaded by
  **file upload** (with an optional retrieval URL) or **URL fetch**.
- Parses **JSON or YAML** and validates that each document is a complete **OAS 3.1 or 3.2**
  document.
- Builds a tree of JSON-Pointer-addressed nodes and **classifies** each node by its OAS
  type (OpenAPI, Info, Paths, Path Item, Operation, Components, Schema, …), flagging
  Reference (`$ref`) objects. OAS 3.2 additions are recognized (`$self`, `query`,
  `additionalOperations`, `mediaTypes`).
- Draws one collapsible, **indented "filesystem" tree** per document (one row per node,
  children indented under their parent), with the documents laid out **side by side** on a
  shared zoom/pan canvas (entry document leftmost). Click a row's **disclosure triangle**
  (or double-click the row) to expand/collapse; click a row to inspect it in the detail
  panel (JSON Pointer, OAS type, value, `$ref` target, base URI).

### References

Resolves `$ref` (in Reference, Path Item, and Schema objects) and `operationRef` (in Link
objects), with JSON-Schema-correct base-URI handling: nested `$id` re-scopes the base, and
targets are located by JSON Pointer **or** `$anchor`/plain-name fragment, same-document or
across the loaded documents (matched by `$self` / retrieval URI).

- Selecting a row reveals its reference arc(s); the detail panel shows **Resolves to →**
  and **Referenced by ←** (both clickable to navigate). A **Show all references** toggle
  draws the whole web.
- A reference must land on a slot of the matching **expected type** (a Reference Object
  inherits the type of the slot it occupies; `operationRef` must hit an Operation).
- Outcomes: **resolved** (arc), **type-mismatch** (red error arc + "expected X, found Y"),
  **broken** (fragment not found) and **external** (target document not loaded) — the last
  two show a ⚠ marker on the row instead of a dangling line.

### Error handling

Three distinct, clearly-surfaced error kinds:

- **Parse error** — the document is not valid JSON/YAML (shown on its row).
- **Not an OpenAPI document** — parses, but has no valid root `openapi` field (shown on its row).
- **Version mismatch** — the OAD mixes OAS 3.1 and 3.2 (shown above the form).

The entry document is always the first one, so there are no "missing/duplicate entry" errors.

## Requirements

- Node.js (developed on v24) and npm.

## Run

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

Then add documents (the first is the **entry document**) and click **Render OAD**.

Sample OADs live in [`public/fixtures/`](public/fixtures) and are served at
`/fixtures/<name>` by the dev server (e.g. a two-document 3.1 OAD: `petstore-3.1.yaml`
referencing `shared-3.1.yaml`; a 3.2 example `tictactoe-3.2.yaml`; and `refs-3.1.yaml` +
`refs-shared-3.1.yaml`, which exercise every reference location and outcome).

```bash
npm run build    # type-check (tsc) + production build to dist/
npm run preview  # serve the production build
npm run typecheck
```

## Tests

```bash
npm test         # run the suite once (Vitest)
npm run test:watch
npm run coverage # run with v8 coverage; writes coverage/ (HTML + lcov) and fails below threshold
```

Specs live in [`test/`](test) mirroring `src/`, built on a `test/helpers.ts` that runs the
real pipeline (`loadDocument → assembleOad → resolveOad`). They cover the core logic — the
reference resolver, OAS classifier + 3.1/3.2 descriptor, model, parser, loader, assembler —
plus jsdom tests for the input form and detail panel. The d3/SVG canvas and tree view are
out of scope for unit coverage (they need real browser layout) and are excluded from the
coverage denominator; they stay verified via the browser/preview workflow. Coverage is
gated by thresholds in `vitest.config.ts`.

## Architecture

A clean **model layer** decoupled from rendering:

| Layer | Files |
| --- | --- |
| Types | `src/types.ts`, `src/errors.ts` |
| Parse | `src/parse/detectFormat.ts` |
| Model | `src/model/jsonPointer.ts`, `src/model/treeBuilder.ts` |
| OAS classification | `src/oas/descriptor.ts` (declarative 3.1/3.2 grammar), `src/oas/classify.ts` |
| Load / assemble | `src/loader.ts` (per document), `src/oad.ts` (whole OAD) |
| References | `src/refs/baseUri.ts`, `src/refs/resolver.ts`, `src/refs/types.ts` |
| Render | `src/render/canvas.ts`, `src/render/treeView.ts`, `src/render/detailPanel.ts`, `src/render/colors.ts` |
| UI | `src/ui/oadForm.ts`, `src/main.ts` |

Each node keeps a stable **JSON Pointer** id and an `expectedType` (its grammar slot type),
and each document keeps its **base URI** (`$self` / retrieval URI) — the foundation the
resolver uses. Documents and `$id` schemas are indexed together as URI-identified
**resources**, so a reference resolves its target resource once and then locates the node.

## Not yet implemented

`operationId` (name-based) Link references; `$dynamicRef`/`$dynamicAnchor`; fetching
external referenced documents not already loaded; fragment (non-OpenAPI) referenced
documents; editing; search/filter; export.
