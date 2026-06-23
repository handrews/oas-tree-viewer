# Changelog

All notable changes to the OpenAPI Description Structure Viewer are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.4.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/handrews/oas-tree-viewer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/handrews/oas-tree-viewer/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/handrews/oas-tree-viewer/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/handrews/oas-tree-viewer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/handrews/oas-tree-viewer/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/handrews/oas-tree-viewer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/handrews/oas-tree-viewer/releases/tag/v0.1.0
