# Contributing

This guide covers the mechanics of working on the repository: local setup, quality gates, CI, and release.
For implementation structure, see [`docs/architecture.md`](docs/architecture.md).

## Requirements

- Node.js 24.
- npm.

Install dependencies with:

```bash
npm ci
```

Use `npm install` only when intentionally changing dependencies.

## Development

```bash
npm run dev
```

The dev server runs at <http://localhost:5173>. The app is client-side; Playwright starts the same dev
server for e2e tests.

## Quality Gates

Run these before opening or merging a change:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run coverage
npm run e2e
npm run build
```

What each command checks:

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint over the repository |
| `npm run format:check` | Prettier formatting check |
| `npm run typecheck` | `svelte-check` with the project TypeScript config |
| `npm run coverage` | Vitest unit/browser tests plus coverage thresholds |
| `npm run e2e` | Playwright end-to-end tests and axe accessibility checks |
| `npm run build` | Production build |

`npm run format` rewrites files with Prettier.

## Test Layout

Tests live under `test/` and `e2e/`.

- Core logic tests run in the Vitest node project.
- Svelte and browser-layout tests run in the Vitest browser project.
- End-to-end and accessibility tests run in Playwright.
- Security tests cover hostile YAML tags, prototype pollution, alias bombs, excessive nesting, and
  deterministic fuzz input.
- Benchmarks are gated behind `VITE_BENCH` and run with `npm run bench`.

Coverage thresholds are configured in `vitest.config.ts`. Some SVG/D3 rendering files are excluded from
the coverage denominator because they require real browser layout; they are covered through browser and e2e
tests instead.

## CI

GitHub Actions runs on pull requests and pushes to `main`.

- `lint`: installs dependencies, runs ESLint, and checks formatting.
- `test`: installs dependencies, installs Playwright Chromium, and runs coverage.
- `e2e`: installs dependencies, installs Playwright Chromium, and runs Playwright.

Dependabot is configured for weekly npm and GitHub Actions version-update PRs. Security updates should be
enabled in repository settings.

## Dependency Changes

When changing dependencies:

1. Use `npm install <package>` or `npm uninstall <package>`.
2. Review both `package.json` and `package-lock.json`.
3. Run `npm ci` to confirm the lockfile is installable from scratch.
4. Run the quality gates above.

Be careful with wholesale lockfile regeneration on macOS. Optional packages needed by Linux CI can be
dropped if the lockfile is regenerated carelessly.

## Release Process

Releases are cut from `main`. Pushing a version tag deploys the live site.

1. Start from a clean, up-to-date `main`.

   ```bash
   git checkout main
   git pull
   git status
   ```

2. Update `CHANGELOG.md`.

   Add a section:

   ```markdown
   ## [X.Y.Z] — YYYY-MM-DD
   ```

   Add the compare link at the bottom:

   ```markdown
   [X.Y.Z]: https://github.com/handrews/oas-tree-viewer/compare/v<previous>...vX.Y.Z
   ```

3. Update `README.md` if user-facing behavior changed.

4. Confirm dependencies install from the lockfile.

   ```bash
   npm ci
   ```

5. Run the release gates.

   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm run coverage
   npm run e2e
   npm run build
   ```

6. Bump the version without letting npm commit or tag.

   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```

7. Commit and tag.

   ```bash
   git add -A
   git commit -m "Release vX.Y.Z"
   git tag -a vX.Y.Z -m vX.Y.Z
   ```

8. Push `main` with annotated tags.

   ```bash
   git push origin main --follow-tags
   ```

The deploy workflow runs on `v*.*.*` tags. It installs dependencies, builds the app, and deploys through
Wrangler to Cloudflare.
