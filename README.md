# OAS Structure Viewer

A TypeScript web app that reads an **OpenAPI Description (OAD)** and renders its parsed
structure as collapsible **indented trees** — every object, array, and scalar shown as a
row, with each node labeled by its OpenAPI Specification (OAS) type — and resolves
references, drawing them as **on-demand arcs** between the referencing field and its target
(including across documents).

_Produced by Henry Andrews using Claude Code._

## What it does

- Loads an OAD made of **one or more documents**: the **first document is the entry
  document** (use **Make entry** to promote another), any others are additional (referenced)
  documents. Each document is loaded by **file upload** (with an optional retrieval URL),
  **URL fetch**, or **Load folder** — a whole directory at once, preserving each file's
  relative path.
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
- **Base URI** of an uploaded file: a provided retrieval URL, else `$self`, else a `file://`
  URL built from the file's path. A **Load folder** upload preserves each file's relative
  path, so subdirectory-relative references (`schemas/pet.yaml#/…`) resolve the same way
  they would when served over HTTP. Supplying a **folder base URL** maps the folder's
  contents onto that URL (replacing the implicit `file://` base) — useful to preview how an
  OAD would resolve when served from a real location.

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

## Not yet implemented

`operationId` (name-based) Link references; `$dynamicRef`/`$dynamicAnchor`; fetching
external referenced documents not already loaded; fragment (non-OpenAPI) referenced
documents; editing; search/filter; export.
