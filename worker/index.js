// Cloudflare Worker entry for the sub-path deployment (https://henryandrews.net/projects/oas).
//
// The Vite build nests its output under dist/projects/oas/, matching this Worker's route
// (henryandrews.net/projects/oas/*), so Cloudflare serves the static assets directly from the `ASSETS`
// binding (see wrangler.jsonc) without invoking this code. The Worker therefore only runs for paths that
// don't match a file — the History-API deep links like /projects/oas/view — where it returns the app
// shell (index.html) so the base-aware client router (src/app/router.svelte.ts) renders the right page.
//
// The shell lives at dist/projects/oas/index.html; how the assets binding resolves a path under a routed
// sub-path isn't guaranteed, so try the mount-prefixed form first and fall back to the bare one.

export default {
  async fetch(request, env) {
    const { origin } = new URL(request.url);
    const nested = await env.ASSETS.fetch(`${origin}/projects/oas/index.html`);
    if (nested.status !== 404) return nested;
    return env.ASSETS.fetch(`${origin}/index.html`);
  },
};
