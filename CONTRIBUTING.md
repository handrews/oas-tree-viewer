# Contributing

This guide covers the project's **architecture**, how its **tests, linting, and formatting** are
organized, and how to **prepare a release**.

## Tests

```bash
npm test         # run the suite once (Vitest)
npm run test:watch
npm run coverage # run with v8 coverage; writes coverage/ (HTML + lcov) and fails below threshold
npm run bench    # render benchmark over large synthetic trees; a normal `npm test` collects it but skips it
```

Specs live in [`test/`](test) mirroring `src/`, built on a `test/helpers.ts` that runs the
real pipeline (`loadDocument → assembleOad → resolveOad`). Vitest runs two projects: a
**node** project for the core logic — the reference resolver (including the `$dynamicRef`
dynamic-scope analysis), OAS classifier + 3.1/3.2 descriptor, model, parser, loader,
assembler — and a **browser** project (`vitest-browser-svelte`) for the Svelte components
(the input form, detail panel, and other islands). The d3/SVG canvas and tree view are
excluded from the coverage denominator (they need real browser layout), but the browser
project still drives the canvas directly to assert its **scalability invariant** — that a
large tree mounts only a bounded number of rows — alongside the browser/preview workflow and
the Playwright end-to-end suite (`npm run e2e`, which also runs axe accessibility checks). The
`bench` harness (`test/browser/treeCanvas.bench.svelte.test.ts`) is gated behind `VITE_BENCH`
so it stays out of the gating run; it reports wall-clock render/expand timings, which are
machine-dependent and informational. Coverage is gated by thresholds in `vitest.config.ts`.

## Linting and formatting

```bash
npm run lint          # ESLint (flat config in eslint.config.js)
npm run format:check  # Prettier — verify formatting without writing (config in .prettierrc.json)
npm run format        # Prettier — reformat in place
```

Both `npm run lint` and `npm run format:check` are **CI gates** — a dedicated `lint` job in
`.github/workflows/ci.yml` — so run them locally before pushing. Prettier owns formatting and
ESLint is configured with `eslint-config-prettier`, so the two never fight over style.

## Architecture

A clean **model layer** (plain TypeScript) decoupled from rendering. The UI is **Svelte 5**,
with **History-API routing** splitting a Configure page from an Explore page; the d3/SVG
canvas is an imperative island wrapped by a Svelte component.

| Layer | Files |
| --- | --- |
| Types | `src/types.ts`, `src/errors.ts`, `src/limits.ts` (resource caps) |
| Parse | `src/parse/detectFormat.ts` |
| Model | `src/model/jsonPointer.ts`, `src/model/treeBuilder.ts` |
| OAS classification | `src/oas/descriptor.ts` (declarative 3.1/3.2 grammar), `src/oas/classify.ts`, `src/oas/dialects.ts` (JSON Schema dialect selection) |
| Load / assemble | `src/loader.ts` (per document), `src/oad.ts` (whole OAD) |
| Validation | `src/validation/validateOad.ts` (OAS schema + per-dialect JSON Schema validation) |
| References | `src/refs/baseUri.ts`, `src/refs/resolver.ts`, `src/refs/types.ts`, `src/refs/diagnostics.ts`, `src/refs/dynamicScope.ts`, `src/refs/fragments.ts`, `src/refs/reachability.ts` |
| Render | `src/render/canvas.ts`, `src/render/treeView.ts`, `src/render/treeLayout.ts` (windowing + label widths), `src/render/treeKeys.ts` (keyboard model), `src/render/colors.ts`, `src/render/issues.ts`, `src/render/reachability.ts`, `src/render/detail.ts`; Svelte islands `TreeCanvas.svelte`, `DetailPanel.svelte`, `Legend.svelte`, `IssueReport.svelte` |
| Worker pipeline | `src/app/pipelineClient.ts` (main-thread client), `src/app/pipeline.worker.ts` (off-thread load) |
| App / routing | `src/app/router.svelte.ts`, `src/app/session.svelte.ts`, `src/app/viewUrl.ts`, `src/app/config.ts`, `src/app/demos.ts`, `src/app/bootstrap.ts` |
| UI / shell | `src/main.ts`, `src/App.svelte`, `src/pages/ConfigurePage.svelte`, `src/pages/ViewPage.svelte`, `src/ui/OadForm.svelte`, `src/ui/ThemeToggle.svelte`, `src/ui/oadForm.ts`, `src/ui/fileDrop.ts`, `src/ui/theme.ts` |
| Styles / pages | `src/styles.css`, `src/theme.css`, `src/docs.css`, `vite/doc-pages.ts` (renders `CHANGELOG.md` to a themed page) |

Each node keeps a stable **JSON Pointer** id and an `expectedType` (its grammar slot type),
and each document keeps its **base URI** (`$self` / retrieval URI) — the foundation the
resolver uses. Documents and `$id` schemas are indexed together as URI-identified
**resources**, so a reference resolves its target resource once and then locates the node.

The whole load pipeline (parse → classify → validate → resolve) runs in a **Web Worker**
(`pipelineClient` on the main thread driving `pipeline.worker`), so a large or slow document
never freezes the UI and a load can be cancelled. The tree renderer is **windowed**: it mounts
only the rows near the viewport and tracks the rest analytically (`treeLayout.ts`), so render
and interaction stay bounded as a document grows.

## Preparing a release

Releases are cut from `main` after the change has been merged. This repository is published as a
git-installable package, and a build of it can be vendored into the repository of a web site that hosts it.
Therefore both the **git tag** and a **correct `package-lock.json`** matter.

Prerequisites: **Node.js 24** and npm (the versions CI uses).

### 1. Start from a clean, up-to-date `main`

```bash
git checkout main
git pull
git status            # must report a clean working tree
```

### 2. Update the changelog and README

Add a section to [`CHANGELOG.md`](CHANGELOG.md) for the new version. Both parts matter — the second
is easy to forget:

- Heading: `## [X.Y.Z] — YYYY-MM-DD`, with the changes grouped (Added / Changed / Fixed / …).
- Compare link at the **bottom** of the file:
  `[X.Y.Z]: https://github.com/handrews/oas-tree-viewer/compare/v<previous>...vX.Y.Z`

If the release changes user-facing behavior, update [`README.md`](README.md) to match.

Leave these edits **uncommitted** — they go into the single release commit in step 5.

### 3. Install from the lockfile and confirm it is in sync

```bash
npm ci
```

`npm ci` installs strictly from `package-lock.json` and **fails if it is out of sync with
`package.json`**. Run it here so the lockfile problem below is caught locally instead of on CI.

> **Lockfile caution:** Running `npm install` to add a dependency can
> silently drop cross-platform **optional** packages from `package-lock.json` — e.g. the `@emnapi/*`
> wasm-fallback entries under `@napi-rs/wasm-runtime`. A lockfile that resolves on macOS then fails
> `npm ci` on the Linux CI runner with *"… can only install … in sync … Missing: @emnapi/core …"*.
> If you add or change a dependency: add its entry **on top of the existing lockfile** (or regenerate
> the lockfile on Linux) rather than committing a wholesale local regeneration, and confirm every
> `@emnapi/*` entry is still present. Note that `npm version` does **not** touch the dependency tree,
> so it neither causes nor fixes this, and `npm ci` only *detects* it — the fix is a correct lockfile.

### 4. Verify the build is green

All of these must pass before tagging (they mirror the CI jobs in `.github/workflows/ci.yml`):

```bash
npm run lint         # ESLint
npm run format:check # Prettier formatting check
npm run typecheck
npm run coverage     # runs the tests and enforces the coverage thresholds
npm run e2e          # Playwright + axe (starts its own dev server)
npm run build
```

### 5. Bump the version, then commit and tag as one release

Bump `package.json` **and** `package-lock.json` without letting npm commit or tag, so the changelog,
README, and version bump all land in a single `Release vX.Y.Z` commit:

```bash
npm version X.Y.Z --no-git-tag-version   # bumps package.json + package-lock.json only
git add -A
git commit -m "Release vX.Y.Z"           # changelog + README + version bump together
git tag -a vX.Y.Z -m vX.Y.Z              # ANNOTATED — required by --follow-tags in step 6
```

`--no-git-tag-version` keeps `npm version`'s lockfile-safe bump (it doesn't touch the dependency
tree — see the caution above) while letting us make one clean release commit instead of a separate
bare bump commit. The tag must be **annotated** (`-a`): `git push --follow-tags` only pushes
annotated tags, and every release tag to date is annotated — keep it that way.

### 6. Push `main` with the tag

```bash
git push origin main --follow-tags
```

`--follow-tags` is required: the `henry-web` deploy installs this repo **by tag**, and
`npm install 'github:handrews/oas-tree-viewer#vX.Y.Z'` only resolves once the tag is on GitHub.
(Quote the argument — an unquoted `#…` can be eaten by the shell.)

### 7. Deploy to a site

The live site is updated from a private repository, which vendors a prebuilt copy of the viewer. Two things to watch out for:

- Re-vendor with the **explicit tag** — a plain `npm install` reports "up to date" and keeps the old
  build, because the lockfile pins a commit SHA:
  ```bash
  # in henry-web/tools
  npm install 'github:handrews/oas-tree-viewer#vX.Y.Z' && npm run build
  ```
- `wrangler.oas-viewer.jsonc` must keep the SPA fallback — `not_found_handling:
  "single-page-application"` (underscores) **inside** the `assets` block — or History-API routes
  (`/configure`, `/view`) 404 on reload.

