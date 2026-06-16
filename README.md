# OAS Structure Viewer

A TypeScript web app that reads an **OpenAPI Description (OAD)** and renders its parsed
structure as **parent/child node-link trees** — every object, array, and scalar shown as
a node connected to its parent, with each node labeled by its OpenAPI Specification (OAS)
type.

This is **v1: the tree view**. A later version will resolve `$ref` references and draw
them as edges across documents (the data model and canvas already anticipate this).

## What it does

- Loads an OAD made of **one or more documents**: an **entry document** plus any number of
  additional documents. Each document is loaded by **file upload** (with an optional
  retrieval URL) or **URL fetch**.
- Parses **JSON or YAML** and validates that each document is a complete **OAS 3.1 or 3.2**
  document.
- Builds a tree of JSON-Pointer-addressed nodes and **classifies** each node by its OAS
  type (OpenAPI, Info, Paths, Path Item, Operation, Components, Schema, …), flagging
  Reference (`$ref`) objects. OAS 3.2 additions are recognized (`$self`, `query`,
  `additionalOperations`, `mediaTypes`).
- Draws one collapsible D3 tree per document on a shared zoom/pan canvas, entry document
  first. Click a node's **dot** to expand/collapse; click its **label** to inspect it in
  the detail panel (JSON Pointer, OAS type, value, `$ref` target, base URI).

### Error handling

Three distinct, clearly-surfaced error kinds, plus entry validation:

- **Parse error** — the document is not valid JSON/YAML (shown on its row).
- **Not an OpenAPI document** — parses, but has no valid root `openapi` field (shown on its row).
- **Version mismatch** — the OAD mixes OAS 3.1 and 3.2 (shown above the form).
- **Entry count** — exactly one document must be marked as the entry.

## Requirements

- Node.js (developed on v24) and npm.

## Run

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

Then add documents, mark exactly one as the **entry document**, and click **Render OAD**.

Sample OADs live in [`public/fixtures/`](public/fixtures) and are served at
`/fixtures/<name>` by the dev server (e.g. a two-document 3.1 OAD: `petstore-3.1.yaml`
referencing `shared-3.1.yaml`, and a 3.2 example `tictactoe-3.2.yaml`).

```bash
npm run build    # type-check (tsc) + production build to dist/
npm run preview  # serve the production build
npm run typecheck
```

## Architecture

A clean **model layer** (decoupled from rendering) so the upcoming reference-resolution
work can reuse it:

| Layer | Files |
| --- | --- |
| Types | `src/types.ts`, `src/errors.ts` |
| Parse | `src/parse/detectFormat.ts` |
| Model | `src/model/jsonPointer.ts`, `src/model/treeBuilder.ts` |
| OAS classification | `src/oas/descriptor.ts` (declarative 3.1/3.2 grammar), `src/oas/classify.ts` |
| Load / assemble | `src/loader.ts` (per document), `src/oad.ts` (whole OAD) |
| Render | `src/render/canvas.ts`, `src/render/treeView.ts`, `src/render/detailPanel.ts`, `src/render/colors.ts` |
| UI | `src/ui/oadForm.ts`, `src/main.ts` |

Each node keeps a stable **JSON Pointer** id, each document keeps its **base URI**
(retrieval URI or `$self`), and every `$ref` node stores its raw target — the hooks the
future resolver will use to draw cross-document reference edges.

## Not yet implemented (v1)

Reference resolution / edges; fragment (non-OpenAPI) referenced documents; editing;
search/filter; export.
