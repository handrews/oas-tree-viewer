// Live History-API routing for the two-page app. All URL parsing lives in the pure (root-relative)
// `viewUrl` module; this thin wrapper owns the reactive `location`/`history` state and the deploy
// base-path. The app is mounted under a sub-path (Vite `base`, e.g. "/projects/oas/"), so
// `window.location.pathname` carries that prefix — strip it before parsing and prepend it when
// navigating, so `viewUrl` stays base-agnostic (and node-testable with plain root paths).

import { canonicalRedirect, parseRoute, stripBase, withBase, type Route } from "./viewUrl";

// The deploy base with no trailing slash: "" at a domain root, "/projects/oas" under a sub-path.
// `import.meta.env.BASE_URL` is Vite's build-time `base` ("/" → "", "/projects/oas/" → "/projects/oas").
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function currentRoute(): Route {
  return parseRoute(stripBase(BASE, window.location.pathname), window.location.search);
}

// A stable object with a reactive `route` property. Reassigning an exported `$state` `let`
// does not propagate across module boundaries, but mutating a property on a const object
// does — so consumers that `import { router }` stay reactive.
export const router = $state<{ route: Route }>({ route: currentRoute() });

/** Navigate to an in-app path, pushing (or replacing) history and updating the route. */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const url = withBase(BASE, path);
  if (opts.replace) window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
  router.route = currentRoute();
}

if (typeof window !== "undefined") {
  // Back/forward.
  window.addEventListener("popstate", () => {
    router.route = currentRoute();
  });
  // Normalize any unrecognized or nested path (within the base) to the page it actually renders, so the
  // address bar matches it (e.g. base, base/foo, base/configure/foo all become base/configure); a valid
  // /view request is untouched.
  const redirect = canonicalRedirect(stripBase(BASE, window.location.pathname));
  if (redirect) navigate(redirect, { replace: true });
}
