<script lang="ts">
  // Full-width collapsible drawer listing every post-render issue, grouped into the same sections as
  // the plain-text report (issueSections), with a Copy button that yields that text. Svelte
  // auto-escapes interpolated text, so doc labels / ref strings are safe by construction.
  import type { IssueReport } from "./issues";
  import { formatIssueReport, issueSections } from "./issues";

  let { report }: { report: IssueReport | null } = $props();

  let copied = $state(false);

  const sections = $derived(report ? issueSections(report) : []);

  async function copy(): Promise<void> {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatIssueReport(report));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
</script>

{#if report}
  <details id="issues" class="issue-drawer" open={report.total > 0}>
    <summary>
      <h2 class="issue-summary-label">Issues</h2>
      <span class="issue-count" class:none={report.total === 0}>{report.total}</span>
    </summary>

    <div class="issue-body">
      {#if report.total === 0}
        <p class="hint">
          No issues found — every reference resolved and every document is reachable from the entry.
        </p>
      {:else}
        <div class="issue-actions">
          <button type="button" class="copy-report" onclick={copy}>
            {copied ? "Copied" : "Copy report"}
          </button>
        </div>

        {#each sections as section (section.id)}
          <h3>{section.label} ({section.items.length})</h3>
          <ul class="issue-list">
            {#each section.items as item (item.key)}
              <li class="issue {item.badgeClass}">
                <span class="issue-status {item.badgeClass}">{item.badge}</span>
                <span class="issue-loc"
                  >{item.doc}{#if item.pointer}&nbsp;<code>{item.pointer}</code>{/if}</span
                >
                {#if item.refString}<code class="issue-ref">{item.refString}</code>{/if}
                <span class="issue-detail">{item.message}</span>
              </li>
            {/each}
          </ul>
        {/each}
      {/if}
    </div>
  </details>
{/if}
