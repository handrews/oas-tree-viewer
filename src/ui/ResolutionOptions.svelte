<script lang="ts">
  import type { ViewerConfig } from "../app/config";

  // Shared with McpPage.svelte's "Call a tool" section, so the same two resolution choices read and
  // behave identically in both places (see src/pages/ConfigurePage.svelte and src/pages/McpPage.svelte).
  let { config = $bindable() }: { config: ViewerConfig } = $props();
</script>

<details class="resolution-options">
  <summary>Resolution options</summary>
  <div class="option-body">
    <label class="option">
      <span class="option-label">Discriminator <code>mapping</code> values resolve as</span>
      <select class="option-select" bind:value={config.mappingPrecedence}>
        <option value="name-first">a component name first (default)</option>
        <option value="uri-first">a URI-reference first</option>
      </select>
    </label>
    <label class="option">
      <span class="option-label">Look up component names in</span>
      <select class="option-select" bind:value={config.componentLookup}>
        <option value="entry">the entry document (default)</option>
        <option value="local">the local document</option>
      </select>
    </label>
  </div>
</details>
