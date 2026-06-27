# OpenAPI Description Structure Viewer

_Produced by Henry Andrews using Claude Code._

This tool takes an [OpenAPI Description](https://learn.openapis.org/glossary.html) (OAD)
or JSON Schema and shows how all of its pieces connect to each other. It was particularly
designed to show how **multi-document OADs** work, with full coverage of all OpenAPI
Specification (OAS) referencing features.

It does not "resolve" the OAD into a more directly-usable artifact. Instead it **demonstrates
the expected behavior** so that tool developers can compare it to what their tool supports, and
authors can explore potential errors visually — with both JSON Pointer and source line
identification.

OAS 3.0+ and JSON Schema draft-04+ are supported, with the focus on the recommended
full-document parsing of OAS 3.1+ and JSON Schema 2020-12. Schema validation (including
changing JSON Schema dialects within a document) uses
[@hyperjump/json-schema](https://github.com/hyperjump-io/json-schema) and runs **offline** from
bundled schemas.

> The visual design is prototype-level and undergoing review; support for Arazzo and Overlays
> is planned once it stabilizes. Live demo: <https://henryandrews.net/projects/oas/>

## What it does

A TypeScript web app that reads an OAD and renders its parsed structure as collapsible,
**indented trees** — one row per object, array, and scalar, each labeled by its OAS type — and
draws **references** as on-demand arcs between the referencing field and its target, including
across documents.

- **Two pages.** A **Configure** page collects the OAD; an **Explore** page renders it in a
  bookmarkable, shareable URL. Loading (parse → classify → validate → resolve → diagnose) runs
  in a background worker, so the page stays responsive and a slow load can be cancelled.
- **Flexible input.** File upload (with an optional retrieval URL), URL fetch, **Load folder**
  (a whole directory at once, preserving each file's relative path), or a built-in demo. An OAD
  can be one or more documents; the **first is the entry document** (use **Make entry** to
  promote another).
- **JSON or YAML**, validated against the official **OAS 3.0 / 3.1 / 3.2** schema. In 3.1/3.2
  each Schema Object is additionally validated against the JSON Schema dialect it declares (the
  OAS dialect, 2020-12, 2019-09, draft-07/06/04); a Schema Object on an older or unknown
  dialect still renders, flagged with a non-blocking warning.
- **Standalone JSON Schema** documents (root is a Schema Object) are rendered and validated as
  such. With **document fragments** enabled (off by default), a bare fragment — a Path Item, a
  shared schema library — is loaded too, its type inferred from the references that point at it.
- **Readable, accessible trees.** Documents are laid out side by side on a shared zoom/pan
  canvas (entry leftmost). Expand/collapse with the disclosure triangle or a double-click; click
  a row to inspect it in the detail panel (JSON Pointer + source line, OAS type, value,
  reference target, base URI). The trees are a keyboard-navigable, screen-reader-accessible
  WAI-ARIA tree, and a toolbar offers Fit, Top/Bottom, Expand all / Collapse all, and Show all
  references. The view is **windowed**, so even a very large document stays responsive.

## References

The viewer resolves every kind of connection an OAS 3.1/3.2 description can express and draws
each as an arc you reveal by selecting a row (or all at once with **Show all references**):

- **`$ref`** and **`operationRef`** — solid arcs.
- **Implicit connections** — Discriminator `mapping` values, Security Requirement keys, and
  Link `operationId`, each resolved by name.
- **`$dynamicRef` / `$recursiveRef`** — drawn as **tentative, dotted** arcs to the anchors that
  could be their runtime target.

A reference must land on a slot of the matching **expected type**. Outcomes are **resolved**,
**type-mismatch** (red error arc), **broken** (fragment not found), and **external** (target
document not loaded). The detail panel shows **Resolves to →** and **Referenced by ←** (both
clickable). Unresolved references, advisories, resolution caveats, unreachable documents, and
unvalidated Schema Objects are collected in a copy-pasteable **issue report**, each finding
showing its source line and jumping to its node when clicked.

A document's **base URI** is its retrieval URL, else `$self`, else a `file://` URL built from
its path. A **Load folder** upload preserves relative paths so subdirectory references resolve
as they would over HTTP; supplying a **folder base URL** maps the folder onto a real location to
preview how it would resolve when served there.

## Errors

Blocking errors are surfaced on the offending document's row, or above the form for OAD-wide
problems:

- **Parse error** — not valid JSON/YAML.
- **Unrecognized document** — neither an OpenAPI nor a JSON Schema document (enable document
  fragments to load it anyway).
- **Schema-invalid document** — fails validation against the official OAS schema.
- **Version mismatch** — the OAD mixes OAS versions.
- **Invalid Link** — a Link Object sets both `operationRef` and `operationId`.
- **Duplicate `operationId`** — two Operations share an `operationId`.
- **Too deeply nested** — refused up front to avoid a stack-overflow crash, with a **Load
  anyway** override. Document size and node count are not capped.

The entry document is always the first one, so there are no "missing/duplicate entry" errors.

## Requirements

- Node.js (developed on v24) and npm.

## Run

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

On the **Configure** page, pick a built-in demo or add your own documents (the first is the
**entry document**) and click **Render OAD** to open the Explore page. Sample OADs live in
[`public/fixtures/`](public/fixtures) and are served at `/fixtures/<name>`.

```bash
npm run build    # svelte-check + production build to dist/
npm run preview  # serve the production build
npm run typecheck
```

## Not yet implemented

- OAS 2.0 (Swagger) support (not planned)
- Search/filter

## Documentation

- **[docs/architecture.md](docs/architecture.md)** — how the viewer is built: the model layer,
  the off-thread worker pipeline, reference resolution, windowed rendering, and diagnostics.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — tests, linting and formatting, and the release
  process.
