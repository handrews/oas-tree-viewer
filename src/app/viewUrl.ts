// Pure codec mapping the app's two routes to/from the URL. The router
// (router.svelte.ts) owns the live `location`/`history` wiring; everything here is
// framework-free and side-effect-free so it can be unit-tested in node.

import { type ViewerConfig, defaultConfig, parseConfig, configParams } from "./config";

/**
 * What the Explore page should load. Uploaded files can't live in a URL (and we don't
 * persist them), so an interactive upload render arrives as a one-shot in-memory handoff
 * — represented here as `session` (a bare `/view`). Demos and online documents encode
 * fully into the URL, so they are bookmarkable.
 */
export type ViewRequest =
  | { kind: "demo"; demoId: string }
  | { kind: "urls"; docs: { url: string; isEntry: boolean }[] }
  | { kind: "session" };

export type Route =
  | { page: "configure" }
  | { page: "view"; request: ViewRequest; config: ViewerConfig };

/**
 * Parse a path + query string into a route. Only `/view` opens the explorer; every other
 * path (`/`, `/configure`, anything unknown) is the configure page. The resolution config
 * is orthogonal to the request kind, so it is parsed independently of demo/doc params.
 */
export function parseRoute(pathname: string, search: string): Route {
  if (!isViewPath(pathname)) return { page: "configure" };

  const params = new URLSearchParams(search);
  const config = parseConfig(params);
  const view = (request: ViewRequest): Route => ({ page: "view", request, config });

  const demoId = params.get("demo");
  if (demoId) return view({ kind: "demo", demoId });

  const urls = params.getAll("doc").filter((u) => u !== "");
  if (urls.length > 0) {
    const entry = clampEntry(params.get("entry"), urls.length);
    const docs = urls.map((url, i) => ({ url, isEntry: i === entry }));
    return view({ kind: "urls", docs });
  }

  return view({ kind: "session" });
}

/**
 * The canonical path a raw location should be rewritten to, or null if it is already canonical. The app
 * renders the configure page for every path except `/view`, so an unrecognized or nested path (`/`,
 * `/foo`, `/configure/foo`, `/configure/`) is normalized to `/configure` — keeping the address bar in
 * step with the page shown. A `/view` request (which carries its own canonical query) is left untouched.
 */
export function canonicalRedirect(pathname: string): string | null {
  if (isViewPath(pathname)) return null;
  return pathname === "/configure" ? null : "/configure";
}

/**
 * Deploy base-path helpers. The app may be mounted under a sub-path (Vite `base`, e.g. "/projects/oas/"),
 * so the live location carries that prefix while the routes above stay root-relative. The router passes
 * `base` (no trailing slash, "" at a domain root); these strip it before parsing and prepend it when
 * navigating, keeping the codec itself base-agnostic.
 */
export function stripBase(base: string, pathname: string): string {
  if (base && (pathname === base || pathname.startsWith(base + "/"))) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}

/** Prepend the deploy base prefix to a root-relative in-app path. */
export function withBase(base: string, path: string): string {
  return base + path;
}

/**
 * Build the `path[?query]` for a view request + config (the configure page navigates to
 * this). The entry document is encoded first; only non-default config is appended.
 */
export function viewPath(request: ViewRequest, config: ViewerConfig = defaultConfig): string {
  const params = new URLSearchParams();
  if (request.kind === "demo") {
    params.set("demo", request.demoId);
  } else if (request.kind === "urls") {
    for (const d of entryFirst(request.docs)) params.append("doc", d.url);
  }
  for (const [key, value] of configParams(config)) params.set(key, value);
  const qs = params.toString();
  return qs ? `/view?${qs}` : "/view";
}

/** Put the entry document first so URL order is meaningful and `entry=` stays unneeded. */
function entryFirst(
  docs: { url: string; isEntry: boolean }[],
): { url: string; isEntry: boolean }[] {
  const entry = docs.findIndex((d) => d.isEntry);
  if (entry <= 0) return docs;
  return [docs[entry]!, ...docs.filter((_, i) => i !== entry)];
}

function isViewPath(pathname: string): boolean {
  return pathname === "/view" || pathname === "/view/";
}

function clampEntry(raw: string | null, count: number): number {
  const n = raw == null ? 0 : Number(raw);
  return Number.isInteger(n) && n >= 0 && n < count ? n : 0;
}
