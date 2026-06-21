<script lang="ts">
  import ThemeToggle from "./ui/ThemeToggle.svelte";
  import ConfigurePage from "./pages/ConfigurePage.svelte";
  import ViewPage from "./pages/ViewPage.svelte";
  import { router } from "./app/router.svelte";

  // App is the shell: a fixed header plus the routed page. The two pages own their own
  // state — ConfigurePage collects sources/demos, ViewPage loads and renders the OAD.
  const view = $derived(router.route.page === "view" ? router.route : null);

  // Version baked in at build time (vite define). Changelog is a rendered page served
  // alongside the app (see vite/doc-pages.ts); GitHub points at the repository (and its README).
  const version = __APP_VERSION__;
  const repoUrl = "https://github.com/handrews/oas-tree-viewer";
</script>

<header id="app-header">
  <h1>OpenAPI Description Structure Viewer</h1>
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
  {:else}
    <ConfigurePage />
  {/if}
</main>
