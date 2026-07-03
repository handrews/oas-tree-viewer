# Contributing

This guide covers how the project's **tests, quality gates, CI, and dependency updates** are
organized and how to **prepare a release**. For the system design — the model layer, the
off-thread worker pipeline, reference resolution, windowed rendering, and diagnostics — see
[docs/architecture.md](docs/architecture.md).

## Tests

```bash
npm test         # run the suite once (Vitest)
npm run test:watch
npm run coverage # run with v8 coverage; writes coverage/ (HTML + lcov) and fails below threshold
npm run bench    # render + pipeline benchmarks over large synthetic docs; a normal `npm test` collects them but skips them
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
the Playwright end-to-end suite (`npm run e2e`, which also runs axe accessibility checks). Two
`bench` harnesses are gated behind `VITE_BENCH` so they stay out of the gating run, both reporting
wall-clock timings that are machine-dependent and informational: a **render** bench
(`test/browser/treeCanvas.bench.svelte.test.ts`, render/expand timings) and a **pipeline** bench
(`test/pipeline.bench.test.ts`, the worker-side source-position and diagnostics stages versus the raw
parse and the full single-document finalize, plus a **resolution** sweep — `resolveOad` over a
reference-heavy document and the `$dynamicRef` scope analyzer over a same-named-anchor chain, the core
resolution paths the reference-free sweep can't reach). Coverage is gated by thresholds in
`vitest.config.ts`.

**Coverage philosophy.** `functions` is held at **100%** — an uncovered function is dead code or a
missing test, so the gate refuses one. The `statements` / `branches` / `lines` floors sit ~1 point under
the measured numbers: high enough to block a real regression, with just enough slack that a single
defensive arm doesn't flake the build. The remaining uncovered lines are **intentionally** left so: they
are defensive `??` / `||` / `catch` fallbacks guarding states the type system or an upstream guard already
prevents — e.g. the second-parse `catch` in `parse/positions.ts` (the text already parsed once), the
`new URL` `catch` in `loader.ts`'s `fileUriFrom`, the `urn:oad:` base-URI fallback in `refs/resolver.ts`
(the loader always supplies a retrieval URI), and `?? label` / `?? "structural"` display fallbacks.
Forcing them to run means fabricating inputs the real pipeline can't produce or reaching into module
internals — brittle tests that assert defensive code and obscure genuine coverage — so chasing the last
few percent isn't worth it now.

**Hostile input.** `test/security.test.ts` (node) asserts the document-processing path is safe against
untrusted input: no arbitrary code runs from YAML tags, no document key pollutes `Object.prototype`,
alias bombs and over-deep nesting are refused with a clean error rather than hanging, and a deterministic
(fixed-seed) fuzz sweep checks those invariants over ~200 random inputs. A browser test
(`test/browser/treeCanvas.svelte.test.ts`) confirms a hostile string value renders as inert text, never
injected markup.

## Linting and formatting

```bash
npm run lint          # ESLint (flat config in eslint.config.js)
npm run format:check  # Prettier — verify formatting without writing (config in .prettierrc.json)
npm run format        # Prettier — reformat in place
```

Both `npm run lint` and `npm run format:check` are **CI gates** (see below), so run them locally
before pushing. Prettier owns formatting and ESLint is configured with `eslint-config-prettier`,
so the two never fight over style.

## Quality gates

Run the full set locally before opening or merging a change — these mirror the CI jobs:

| Command | Checks |
| --- | --- |
| `npm run lint` | ESLint over the repository |
| `npm run format:check` | Prettier formatting (no writes) |
| `npm run typecheck` | `svelte-check` against the project `tsconfig` |
| `npm run coverage` | Both Vitest projects (node + browser) plus the coverage thresholds |
| `npm run e2e` | Playwright end-to-end tests, including axe accessibility checks |
| `npm run build` | Production build (`vite build`) |

## Continuous integration

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every pull request
and on pushes to `main` (an in-flight run is cancelled when newer commits land), all on Node 24:

- **Lint** — `npm run lint` and `npm run format:check`.
- **Test & coverage** — `npm ci` (whose `prepare` script runs `svelte-check` + build, so a type
  error or broken build fails here), installs Playwright Chromium for the browser project, then
  `npm run coverage`.
- **E2E** — installs Playwright Chromium, then `npm run e2e`; traces are uploaded on failure.

Dependency updates are automated by Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)):
weekly **version-update** PRs grouped into one per ecosystem (npm, GitHub Actions); **security
updates** arrive separately as immediate PRs and must be enabled once in repo settings.

## Dependency changes

When adding or changing a dependency:

1. Use `npm install <pkg>` / `npm uninstall <pkg>` — not a wholesale lockfile regeneration.
2. Review the `package.json` **and** `package-lock.json` diff.
3. Run `npm ci` to confirm the lockfile still installs cleanly from scratch.
4. Run the quality gates above.

See the **lockfile caution** under "Preparing a release" for the cross-platform optional-package
(`@emnapi/*`) trap a careless regeneration triggers on the Linux CI runner.

## Preparing a release

Releases are cut from `main` after the change has been merged, and **pushing the version tag deploys the
live site** (step 7). The running app bakes in its `package.json` version, and the deploy builds from the
lockfile, so both the **git tag** and a **correct `package-lock.json`** matter.

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

If the release changes user-facing behavior, update [`README.md`](README.md) to match; if it
changes the design, update [`docs/architecture.md`](docs/architecture.md) too.

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

`--follow-tags` pushes the annotated tag alongside `main`. Pushing the tag is what **triggers the
production deploy** (step 7), so the tag has to reach GitHub for the site to update.

### 7. The deploy (automatic, on the tag)

Pushing the `vX.Y.Z` tag triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which
runs `npm ci` → `npm run build` → `wrangler deploy` to publish the **`oas-tree-viewer`** Cloudflare
Worker, live at **<https://henryandrews.net/projects/oas>**. Nothing is vendored or copied by hand.

Confirm it: watch the **Deploy** run under the repo's Actions tab, then load
`https://henryandrews.net/projects/oas/` — and `https://henryandrews.net/projects/oas` (no trailing
slash), which should 307-redirect to the slashed form. To re-run a deploy **without** cutting a new
version (e.g. to retry a failed run), use **Actions → Deploy → Run workflow** — a `workflow_dispatch`
that deploys the current `main`.

**Required repo secrets** (Settings → Secrets and variables → Actions), for the Cloudflare account that
owns the Worker and the `henryandrews.net` zone:

- `CLOUDFLARE_API_TOKEN` — scopes **Workers Scripts: Edit** (account) + **Workers Routes: Edit** (zone).
- `CLOUDFLARE_ACCOUNT_ID`.

Deploy config lives in [`wrangler.jsonc`](wrangler.jsonc) + [`worker/index.js`](worker/index.js). Gotchas:

- **Wrangler 4 is required.** `cloudflare/wrangler-action@v3` installs a 3.x Wrangler by default, which
  predates Worker-with-assets-binding support and fails with _"Missing entry-point"_; `deploy.yml` pins
  `wranglerVersion: "4"`.
- **The app is served from a sub-path** (`/projects/oas/`), not a domain root — so `vite.config.ts` sets
  `base: "/projects/oas/"` and nests the build under `dist/projects/oas/`, and any same-origin URL the
  app builds (e.g. demo fixtures in `demos.ts`) must be prefixed with `import.meta.env.BASE_URL`. A bare
  `/fixtures/…` escapes the sub-path, 404s, and falls through to the SPA shell.
- **Two routes** are configured: `henryandrews.net/projects/oas/*` (the app + assets) and the exact
  `henryandrews.net/projects/oas` (the bare path, which `/*` does not match — Cloudflare's asset layer
  307-redirects it to the slashed form). Both must out-specify the main `henryandrews.net` Worker's catch-all
  (`henryandrews.net/*`); the more specific route wins.
- **Deep links** (`/projects/oas/view?…`) are served by `worker/index.js`, which returns the app shell
  for any path with no matching asset, so reloading a History-API route works.

