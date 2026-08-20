<script lang="ts">
  import type { ViewerConfig } from "../app/config";
  import { FRAGMENTS_CONTROL_LABEL, FRAGMENTS_OPTIONS } from "../fragmentsText";

  // Shared with McpPage.svelte's "Call a tool" section, so the "Document types" choice reads and
  // behaves identically in both places (see src/pages/ConfigurePage.svelte and src/pages/McpPage.svelte).
  let { config = $bindable() }: { config: ViewerConfig } = $props();
</script>

<!-- The visible "Document types" text is the select's accessible name (so no aria-label). -->
<label class="load-behavior-field">
  <span class="load-behavior-label">{FRAGMENTS_CONTROL_LABEL}</span>
  <select class="load-behavior" bind:value={config.fragments}>
    {#each FRAGMENTS_OPTIONS as opt (opt.value)}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
</label>
