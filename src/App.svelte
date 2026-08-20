<script lang="ts">
  import ThemeToggle from "./ui/ThemeToggle.svelte";
  import ConfigurePage from "./pages/ConfigurePage.svelte";
  import ViewPage from "./pages/ViewPage.svelte";
  import { router, navigate, appHref } from "./app/router.svelte";

  // App is the shell: a fixed header plus the routed page. The pages own their own
  // state — ConfigurePage collects sources/demos, ViewPage loads and renders the OAD. McpPage pulls
  // in the MCP SDK + zod, so it is dynamically imported — a leaf chunk `/configure` and `/view` never
  // request (see e2e/mcp.spec.ts's code-split guard).
  const view = $derived(router.route.page === "view" ? router.route : null);
  const mcp = $derived(router.route.page === "mcp" ? router.route : null);

  // Version baked in at build time (vite define). Changelog is a rendered page served
  // alongside the app (see vite/doc-pages.ts); GitHub points at the repository (and its README).
  const version = __APP_VERSION__;
  const repoUrl = "https://github.com/handrews/oas-tree-viewer";

  // A real <a> (not a click handler on the h1) so middle-click/new-tab work; a plain left-click is
  // intercepted to keep it an SPA transition instead of a full navigation. Skipped on the configure
  // page itself, where the heading has nowhere further to send you.
  function onHeadingClick(e: MouseEvent): void {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate("/configure");
  }
</script>

<header id="app-header">
  <h1>
    {#if router.route.page === "configure"}
      OpenAPI Description Structure Viewer
    {:else}
      <a href={appHref("/configure")} onclick={onHeadingClick}>
        OpenAPI Description Structure Viewer
      </a>
    {/if}
  </h1>
  <p class="header-meta">
    <span class="version">v{version}</span>
    <span class="sep" aria-hidden="true">•</span>
    <a href="changelog.html">Changelog</a>
    <span class="sep" aria-hidden="true">•</span>
    <a href={repoUrl} target="_blank" rel="noopener noreferrer">GitHub</a>
  </p>
  <ThemeToggle />
</header>

<main id="app">
  {#if view}
    <ViewPage request={view.request} config={view.config} />
  {:else if mcp}
    {#await import("./pages/McpPage.svelte") then { default: McpPage }}
      <McpPage request={mcp.request} config={mcp.config} />
    {/await}
  {:else}
    <ConfigurePage />
  {/if}
</main>
