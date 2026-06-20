<script lang="ts">
  import ThemeToggle from "./ui/ThemeToggle.svelte";
  import ConfigurePage from "./pages/ConfigurePage.svelte";
  import ViewPage from "./pages/ViewPage.svelte";
  import { router } from "./app/router.svelte";

  // App is the shell: a fixed header plus the routed page. The two pages own their own
  // state — ConfigurePage collects sources/demos, ViewPage loads and renders the OAD.
  const viewRequest = $derived(router.route.page === "view" ? router.route.request : null);
</script>

<header id="app-header">
  <h1>OAS Structure Viewer</h1>
  <p class="tagline">
    Parent/child structure of an OpenAPI Description, document by document.
  </p>
  <ThemeToggle />
</header>

<main id="app">
  {#if viewRequest}
    <ViewPage request={viewRequest} />
  {:else}
    <ConfigurePage />
  {/if}
</main>
