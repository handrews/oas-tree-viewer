# Contributing

The only process documented here, for now, is **preparing a release**.

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

### 2. Update the changelog

Add a section to [`CHANGELOG.md`](CHANGELOG.md) for the new version and its compare link at the
bottom of the file:

- Heading: `## [X.Y.Z] — YYYY-MM-DD`, with the changes grouped (Added / Changed / Fixed / …).
- Link: `[X.Y.Z]: https://github.com/handrews/oas-tree-viewer/compare/v<previous>...vX.Y.Z`

Commit it (the working tree must be clean before `npm version` in step 5):

```bash
git add CHANGELOG.md
git commit -m "Changelog for vX.Y.Z"
```

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

All of these must pass before tagging:

```bash
npm run typecheck
npm run coverage     # runs the tests and enforces the coverage thresholds
npm run e2e          # Playwright + axe (starts its own dev server)
npm run build
```

### 5. Bump the version and tag

`npm version` updates `package.json` **and** `package-lock.json`, creates a commit, and tags it
`vX.Y.Z`:

```bash
npm version patch    # 0.3.0 -> 0.3.1   (use `minor` for 0.4.0, `major` for 1.0.0)
```

### 6. Push `main` with the tag

```bash
git push origin main --follow-tags
```

`--follow-tags` is required: the `henry-web` deploy installs this repo **by tag**, and
`npm install github:handrews/oas-tree-viewer#vX.Y.Z` only resolves once the tag is on GitHub.

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

