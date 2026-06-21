<script lang="ts">
  // Full-width collapsible drawer listing every post-render issue (unresolved references and
  // unreachable documents), with a Copy button that yields the same plain-text report. Svelte
  // auto-escapes interpolated text, so doc labels / ref strings are safe by construction.
  import type { IssueReport } from "./issues";
  import { formatIssueReport } from "./issues";

  let { report }: { report: IssueReport | null } = $props();

  let copied = $state(false);

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
          No issues found — every reference resolved and every document is reachable from the
          entry.
        </p>
      {:else}
        <div class="issue-actions">
          <button type="button" class="copy-report" onclick={copy}>
            {copied ? "Copied" : "Copy report"}
          </button>
        </div>

        {#if report.refIssues.length}
          <h3>Unresolved references ({report.refIssues.length})</h3>
          <ul class="issue-list">
            {#each report.refIssues as i (i.sourceDoc + i.sourcePointer + i.refString)}
              <li class="issue status-{i.status}">
                <span class="issue-status status-{i.status}">{i.status}</span>
                <span class="issue-loc">{i.sourceDoc} <code>{i.sourcePointer}</code></span>
                <code class="issue-ref">{i.refString}</code>
                <span class="issue-detail">{i.detail}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if report.advisories.length}
          <h3>Reference advisories ({report.advisories.length})</h3>
          <ul class="issue-list">
            {#each report.advisories as a (a.sourceDoc + a.sourcePointer + a.code + a.refString)}
              <li class="issue severity-{a.severity}">
                <span class="issue-status severity-{a.severity}">{a.severity}</span>
                <span class="issue-loc">{a.sourceDoc} <code>{a.sourcePointer}</code></span>
                <code class="issue-ref">{a.refString}</code>
                <span class="issue-detail">{a.detail}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if report.docIssues.length}
          <h3>Unreachable documents ({report.docIssues.length})</h3>
          <ul class="issue-list">
            {#each report.docIssues as i (i.doc)}
              <li class="issue status-unreachable">
                <span class="issue-status status-unreachable">unreachable</span>
                <span class="issue-loc">{i.doc}</span>
                <span class="issue-detail">{i.detail}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </details>
{/if}
