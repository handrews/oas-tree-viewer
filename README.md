# OpenAPI Description Structure Viewer

A TypeScript web app that reads an **OpenAPI Description (OAD)** and renders its parsed
structure as collapsible **indented trees** — every object, array, and scalar shown as a
row, with each node labeled by its OpenAPI Specification (OAS) type — and resolves
references, drawing them as **on-demand arcs** between the referencing field and its target
(including across documents).

_Produced by Henry Andrews using Claude Code._

## What it does

- Presents two pages: a **Configure** page collects the OAD — by **file upload** (with an
  optional retrieval URL), **URL fetch**, **Load folder** (a whole directory at once,
  preserving each file's relative path), or a **built-in demo** — and an **Explore** page
  renders it. The Explore view is captured in a **bookmarkable, shareable URL** (the demo or
  online-document URLs, plus the resolution options below).
- Loads an OAD made of **one or more documents**: the **first document is the entry
  document** (use **Make entry** to promote another), any others are additional (referenced)
  documents.
- Parses **JSON or YAML** and validates each document against the official **OAS 3.1 or 3.2**
  JSON Schema — **offline**, since the schemas are bundled rather than fetched at runtime. Schema
  Objects are validated against their declared dialect (the OAS dialect or standard JSON Schema
  2020-12); a document using any other dialect still renders, with a non-blocking warning that its
  Schema Objects were not validated.
- Builds a tree of JSON-Pointer-addressed nodes and **classifies** each node by its OAS
  type (OpenAPI, Info, Paths, Path Item, Operation, Components, Schema, …), flagging
  Reference (`$ref`) objects. OAS 3.2 additions are recognized (`$self`, `query`,
  `additionalOperations`, `mediaTypes`).
- Draws one collapsible, **indented "filesystem" tree** per document (one row per node,
  children indented under their parent), with the documents laid out **side by side** on a
  shared zoom/pan canvas (entry document leftmost). Click a row's **disclosure triangle**
  (or double-click the row) to expand/collapse; click a row to inspect it in the detail
  panel (JSON Pointer, OAS type, value, reference target, base URI).

### References

Resolves every kind of connection an OAS 3.1/3.2 description can express, with
JSON-Schema-correct base-URI handling: nested `$id` re-scopes the base, and targets are
located by JSON Pointer **or** `$anchor`/plain-name fragment, same-document or across the
loaded documents (matched by `$self` / retrieval URI).

- **`$ref`** (in Reference, Path Item, and Schema objects) and **`operationRef`** (in Link
  objects) — URI-references, drawn as solid arcs.
- **Component-name references** — Discriminator `mapping` values and Security Requirement
  keys, each resolved as a component name or a URI-reference (per OAS version and the
  resolution options) and drawn as a distinct **implicit connection**.
- **Link `operationId`** — resolved to its Operation, as an implicit connection.
- **`$dynamicRef` / `$dynamicAnchor`** — a dynamic `$dynamicRef` is drawn as **tentative,
  dotted** arcs to its *strict winners*: the `$dynamicAnchor`s that could actually be its
  runtime resolution (the outermost same-named anchor on an evaluation path, rooted in the
  entry document, that reaches the reference). The JSON Schema "bookending" cases (a local
  `$anchor`, or a `$ref` landing on a `$dynamicAnchor`) resolve statically, like `$ref`.
- **Operation-reference advisories** — an `operationRef`/`operationId` that resolves but
  points somewhere not unambiguously callable (e.g. a webhook or callback Operation) is
  flagged with an advisory rather than treated as broken.

Selecting a row reveals its reference arc(s); the detail panel shows **Resolves to →** and
**Referenced by ←** (both clickable to navigate), and a **Show all references** toggle draws
the whole web. A reference must land on a slot of the matching **expected type** (a Reference
Object inherits the type of the slot it occupies; an operation reference must hit an
Operation). Outcomes: **resolved**, **type-mismatch** (red error arc + "expected X, found
Y"), **broken** (fragment not found), and **external** (target document not loaded) — the
last two show a ⚠ marker on the row instead of a dangling line. Unresolved references and
unreachable documents are collected in a copy-pasteable **issue report**.

- **Base URI** of an uploaded file: a provided retrieval URL, else `$self`, else a `file://`
  URL built from the file's path. A **Load folder** upload preserves each file's relative
  path, so subdirectory-relative references (`schemas/pet.yaml#/…`) resolve the same way
  they would when served over HTTP. Supplying a **folder base URL** maps the folder's
  contents onto that URL (replacing the implicit `file://` base) — useful to preview how an
  OAD would resolve when served from a real location.

### Error handling

Errors are surfaced where they arise — on a document's row, or above the form for OAD-wide
problems:

- **Parse error** — the document is not valid JSON/YAML (shown on its row).
- **Not an OpenAPI document** — parses, but has no valid root `openapi` field (shown on its row).
- **Schema-invalid document** — fails validation against the official OpenAPI JSON Schema, with the
  offending JSON Pointer locations listed (shown on its row).
- **Version mismatch** — the OAD mixes OAS 3.1 and 3.2 (shown above the form).
- **Invalid Link** — a Link Object sets both `operationRef` and `operationId` (shown on its row).
- **Duplicate `operationId`** — two Operations share an `operationId` anywhere in the OAD
  (shown above the form).

The entry document is always the first one, so there are no "missing/duplicate entry" errors.

## Requirements

- Node.js (developed on v24) and npm.

## Run

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

On the **Configure** page, pick a **built-in demo** (one per reference style) or add your own
documents (the first is the **entry document**) and click **Render OAD** to open the Explore
page.

Sample OADs live in [`public/fixtures/`](public/fixtures) and are served at
`/fixtures/<name>` by the dev server (e.g. a two-document 3.1 OAD: `petstore-3.1.yaml`
referencing `shared-3.1.yaml`; a 3.2 example `tictactoe-3.2.yaml`; and `refs-3.1.yaml` +
`refs-shared-3.1.yaml`, which exercise every reference location and outcome).

```bash
npm run build    # svelte-check + production build to dist/
npm run preview  # serve the production build
npm run typecheck
```

## Not yet implemented

* Standalone JSON Schema documents
* Fragmentary OpenAPI documents (neither an OpenAPI Object nor Schema Object at the root)
* OAS 3.0 support (OAS 2.0 support is not planned)
* Search/filter

## Contributing

Testing, the project architecture, and the release process are documented in
[CONTRIBUTING.md](CONTRIBUTING.md).
