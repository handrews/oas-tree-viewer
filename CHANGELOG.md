# Changelog

All notable changes to the OpenAPI Description Structure Viewer are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Source line numbers.** Each node's source line is shown next to its JSON Pointer in the detail
  panel, every issue in the report shows its line, and clicking a located issue reveals that node in
  the tree. Positions are computed off the main thread from the document's own text (best-effort,
  for both JSON and YAML).

### Changed

- **Non-blocking diagnostics are unified.** Unresolved or mis-typed references, reference
  advisories, node-level resolution caveats, unreachable documents, and unvalidated Schema Objects
  are now one model, located by JSON Pointer and computed in the load worker. As a visible result,
  the **unsupported-dialect resolution caveat now also appears in the issue report** (previously it
  was only a tree glyph and a detail-panel note).
- **The diagnostic severity policy, the connection styles, and the demo copy are editable as data, with
  no code change.** Each diagnostic's severity, title, and description live in `content/diagnostics.yaml`;
  each connection kind's reference arrow/marker style (line, dash, arrowhead, marker) lives in
  `content/connections.yaml`; and each built-in demo's label and description live in `content/demos.yaml`.
- **A reference advisory's color is now one configurable source.** The arc tint, the ▲ gutter glyph, and
  the detail-panel note all take their severity from the diagnostic catalog policy, so changing an
  advisory's severity (or turning it `off`) moves all three together.

## [0.8.3] - 2026-06-25

### Fixed

- More deployment configuration, redirect non-trailing-"/" to trailing-"/".

## [0.8.2] — 2026-06-25

### Fixed

- Deployment configuration and wrangler version.

## [0.8.1] — 2026-06-25

### Changed

- Deploy directly from the repository.

## [0.8.0] — 2026-06-24

### Added

- **Top and Bottom toolbar buttons** that jump to either end of a tall tree, alongside the existing
  Fit / Expand all / Collapse all / Show all references controls.

### Changed

- **Large documents now render without freezing the page.** The tree is windowed to the viewport —
  only the rows currently in view are mounted, while the rest are tracked analytically — so even very
  large, heavily-referenced descriptions stay responsive to pan, zoom, expand, and collapse. As a
  result the earlier document-size and node-count limits are lifted (only a nesting-depth guard
  remains), and **Expand all** no longer prompts. **Show all references** still confirms before
  drawing a very large number of arcs at once, and now notes that at that scale the arcs may render
  imperfectly.
- **Configure page:** the document-type selector, the document list, and the resolution options are
  grouped in a single framed panel, and the document-type selector now carries a visible **Document
  types** label.

## [0.7.0] — 2026-06-24

### Changed

- **Document processing now runs off the main thread.** Loading, parsing, classification, reference
  resolution, and validation run in a Web Worker, so the page stays responsive while a large or
  heavily referenced document is processed. A **Cancel** control stops an in-progress load.

## [0.6.0] — 2026-06-23

### Added

- **Keyboard navigation and screen-reader support for the document trees.** Each tree is now a
  WAI-ARIA Tree View — `tree` / `treeitem` roles with level, expanded, and selected state and an
  accessible name per node. Arrow keys move between nodes (Up/Down) and expand or collapse them
  (Right/Left), Home/End jump to the first/last visible node, and Enter or Space selects the focused
  node (opening it in the detail panel). A visible focus ring, distinct from the selection highlight,
  follows keyboard focus, and the canvas scrolls the focused node into view.
- **Guards against oversized or deeply-nested documents.** A document too large (by byte size or node
  count) or too deeply nested is refused up front with a clear, located message instead of freezing the
  page, with a **Load anyway** override that retries with the limits lifted. Separately, **Expand all**
  and **Show all references** confirm before rendering a very large number of rows or arcs at once.

## [0.5.0] — 2026-06-23

### Added

- **OAS 3.0 support.** OpenAPI 3.0 documents now load, render, and validate. A 3.0 Schema Object is
  not JSON Schema, so a Schema `$ref` is shown as a Reference Object and the whole document is
  validated against the single bundled OAS 3.0 schema — there are no Schema-Object dialects.
- **Standalone JSON Schema documents.** A document whose root is a Schema Object (detected by a root
  `$id`/`$schema`) is rendered as a Schema Object tree and validated against its declared dialect; its
  header shows the JSON Schema dialect instead of an OAS version.
- **Document fragments** (opt-in, off by default). A document that is neither a complete OpenAPI
  document nor a JSON Schema document — for example a bare Path Item Object, a standalone Schema
  Object, or a reusable Components Object — can be loaded and typed from the references that point at
  it. *Referenced by the root* types a fragment from a reference to its root; *any fragment* also
  types it from references to its interior nodes (only the referenced node and its descendants take a
  type) and tolerates an unreferenced fragment. References that disagree about a node's type make just
  that node generic and flag the conflicting references as errors.
- Built-in OAS 3.0 fragment demos: a Path Item + Schema split, and a reusable Components Object library.

### Changed

- On the Configure page, the load-behavior selector now sits with the documents it governs, and the
  **Render OAD** button moves into the resolution-options row.

## [0.4.1] — 2026-06-22

### Added

- **Reference resolution for older JSON Schema dialects.** A Schema Object that declares an older
  dialect now has its references resolved with that dialect's own identification rules, instead of a
  2020-12 best-effort:
  - **draft-2019-09** — `$recursiveRef` / `$recursiveAnchor`, drawn like `$dynamicRef` as tentative,
    dotted arcs to the outermost recursive anchor on an entry-rooted path.
  - **draft-07, draft-06, draft-04** — named anchors come from identifier fragments (`$id`, or `id`
    in draft-04), and the constructs these drafts ignore are flagged: a `$ref` with sibling keywords,
    and an identifier fragment that is not the schema's own location.
- **Per-resource Schema Object validation.** Each Schema Object is validated against the dialect it
  declares in `$schema` rather than a single document-wide default, so a document mixing dialects
  validates each part correctly. Only dialects too old for the bundled validator stay unvalidated.
- Built-in **`$recursiveRef`** (2019-09) and **draft-04/06/07** reference demos.

## [0.4.0] — 2026-06-22

### Added

- **OpenAPI schema validation.** Every loaded document is validated against the official OpenAPI
  Description JSON Schema for its version — **fully offline**, since the OAS 3.1/3.2 schemas are
  bundled with the validator rather than fetched at runtime. A document that fails validation is
  rejected on its row, with the offending JSON Pointer locations listed.
- **Dialect-aware Schema Object validation.** Schema Objects are validated against their declared
  dialect: the OAS dialect and standard JSON Schema 2020-12 are checked in full; a document using
  any other dialect still renders, flagged with a non-blocking **Unvalidated Schema Objects**
  warning in the issue report.

## [0.3.1] — 2026-06-21

### Added

- A rendered **Changelog** page, themed to match the app and served alongside it, reachable
  from the header.

### Changed

- The header is now two compact lines: the renamed title **"OpenAPI Description Structure
  Viewer"** above a single line carrying the version, a Changelog link, and a GitHub link.
- **`$dynamicRef` resolution is more precise.** A dynamic `$dynamicRef` now points only at the
  `$dynamicAnchor`s that could actually be its runtime resolution — the outermost same-named
  anchor on an evaluation path, rooted in the entry document, that reaches the reference —
  rather than at every same-named anchor in a reachable document. Anchors that can never be
  reached, or are always shadowed by an outer one, are no longer shown.
- Tentative (`$dynamicRef`) arcs use denser, more legible dotting.

### Fixed

- The Explore page's headings now descend without skipping a level, for a clean accessibility
  audit.

## [0.3.0] — 2026-06-20

The reference-resolution release: the viewer now understands every kind of connection
an OAS 3.1/3.2 description can express, and the app is split into two pages.

### Added

- **Two-page layout.** A **Configure** page collects the OAD (uploads, URLs, folders,
  or a built-in demo); an **Explore** page renders it. The exploration view is captured
  in a bookmarkable, shareable URL.
- **Built-in demos** for each reference style, loaded from same-origin fixtures.
- **Component-name references.** Resolve Discriminator `mapping` values and Security
  Requirement keys, drawn as implicit connections visually distinct from `$ref`.
- **Operation-reference diagnostics.** Link `operationRef` targets are validated (for
  example, flagging a target that is a webhook and so not directly callable), with
  advisories surfaced in the issue report, the detail panel, the canvas, and the legend.
- **Link `operationId` resolution.** A Link's `operationId` resolves to its Operation
  and is marked resolved or broken.
- **`$dynamicRef` / `$dynamicAnchor`.** A dynamic `$dynamicRef` points tentatively — a
  dotted arc — at every entry-reachable `$dynamicAnchor` of its name, since the real
  target depends on the evaluation path. The JSON Schema "bookending" cases (a local
  `$anchor`, or a `$ref` landing on a `$dynamicAnchor`) resolve statically, like `$ref`.
- **Resolution config**, encoded in the view URL, controlling version-conditional
  resolution behavior.

### Validation

- A Link that sets both `operationRef` and `operationId` is now a load error.
- Two Operations sharing an `operationId` anywhere in the OAD is now a load error.

### Changed

- CI runners bumped to actions v5 (Node 24 runtime).

## [0.2.3] — 2026-06-19

### Added

- **Regrouped node colors** into semantic categories, with reference fields marked by an
  asterisk and an expanded legend explaining every marker.
- **Unreachable-document warnings** for documents not reachable from the entry document.
- **Copy-pasteable issue report** drawer summarizing unresolved references and warnings.
- **CI workflow** running tests, coverage, and the end-to-end suite on pull requests.

### Changed

- Upgraded to Vite 8 and `@sveltejs/vite-plugin-svelte` 7.

## [0.2.2] — 2026-06-18

### Added

- **Redesigned OAD input form**: unified rows that each take a local file or a URL, plus
  directory bundles that preserve every file's relative path.
- **Drag-and-drop** loading of files and folders.
- The **document base URI** is now shown in each tree header.

### Changed

- Unified the tree and legend marker shapes; lowercased the generic-kind labels.
- Reference arcs now run from the source's right edge to the target's left edge, with an
  S-curve that stays clear of the target's controls.

### Fixed

- The "Choose folder…" button no longer silently loses its selection.

## [0.2.1] — 2026-06-18

### Changed

- Made unresolved-reference markers clearer and less obtrusive.

## [0.2.0] — 2026-06-17

### Changed

- **Migrated to Svelte 5** (shell-first), converting the input form, detail panel, and
  theme toggle to Svelte components.

## [0.1.1] — 2026-06-16

### Added

- **Light/dark theming** with accessible Forest palettes.
- **Playwright end-to-end tests** with axe accessibility checks.

### Fixed

- Declared `@types/node` so the production build is self-contained.

## [0.1.0] — 2026-06-16

Initial deployment.

### Added

- Parse a JSON or YAML **OpenAPI Description** (OAS 3.1 or 3.2) made of one or more
  documents and validate each as a complete OpenAPI document.
- Render each document as a collapsible, indented **parent/child tree**, laid out side by
  side on a shared zoom/pan canvas (entry document first).
- **Classify** each node by its OAS type and flag Reference (`$ref`) objects.
- **Resolve references** — within and across documents — and draw them as on-demand arcs
  between the referencing field and its target.
- Load documents by **file upload** (with an optional retrieval URL), **URL fetch**, or
  **directory upload** preserving relative paths.
- A **detail panel** showing each node's JSON Pointer, OAS type, value, and reference
  target.
- A **Vitest** test suite with enforced coverage.

[Unreleased]: https://github.com/handrews/oas-tree-viewer/compare/v0.8.3...HEAD
[0.8.3]: https://github.com/handrews/oas-tree-viewer/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/handrews/oas-tree-viewer/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/handrews/oas-tree-viewer/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/handrews/oas-tree-viewer/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/handrews/oas-tree-viewer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/handrews/oas-tree-viewer/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/handrews/oas-tree-viewer/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/handrews/oas-tree-viewer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/handrews/oas-tree-viewer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/handrews/oas-tree-viewer/releases/tag/v0.1.0
