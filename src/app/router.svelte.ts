// Live History-API routing for the two-page app. All URL parsing lives in the pure
// `viewUrl` module; this thin wrapper owns the reactive `location`/`history` state. Routes
// are single-segment (`/configure`, `/view`) so the relative asset base keeps resolving
// `./assets/…` correctly under the SPA fallback.

import { parseRoute, type Route } from "./viewUrl";

function currentRoute(): Route {
  return parseRoute(window.location.pathname, window.location.search);
}

// A stable object with a reactive `route` property. Reassigning an exported `$state` `let`
// does not propagate across module boundaries, but mutating a property on a const object
// does — so consumers that `import { router }` stay reactive.
export const router = $state<{ route: Route }>({ route: currentRoute() });

/** Navigate to an in-app path, pushing (or replacing) history and updating the route. */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  router.route = currentRoute();
}

if (typeof window !== "undefined") {
  // Back/forward.
  window.addEventListener("popstate", () => {
    router.route = currentRoute();
  });
  // Tidy the bare root into the canonical configure path.
  if (window.location.pathname === "/") navigate("/configure", { replace: true });
}
