<script lang="ts">
  // A type-only import: hosts/browser.ts pulls in the MCP SDK + zod, and McpPage.svelte dynamically
  // imports it for exactly that reason (see App.svelte). WireLog.svelte is imported statically by
  // McpPage.svelte, so a runtime (value) import here would join that dynamic boundary right back to
  // the main bundle — only the erased type is safe to name.
  import type { WireExchange } from "../hosts/browser";

  // Renders exactly what went over the wire, grouped by the user action that caused it (see
  // `beginAction` in hosts/browser.ts): one `<details>` per action, each holding its exchanges as
  // one-line summaries — method, tool/resource name, HTTP status, response content-type — that expand
  // to the full request/response detail. The content-type on every summary line is what preserves the
  // page's SSE-vs-JSON contrast at a glance, with or without expanding anything.
  //
  // Every `.wire-json` <pre> below carries `tabindex="0"`: it scrolls (see `.wire-json`'s
  // `overflow: auto` / `max-height` in styles.css), and WCAG 2.1.1/1.4.13 requires a scrollable
  // region to be keyboard-reachable — svelte-check's generic a11y heuristic flags a <pre> as
  // "noninteractive" and warns on this, but the warning is exactly backwards here.

  let { exchanges }: { exchanges: WireExchange[] } = $props();

  interface Group {
    action: string;
    exchanges: WireExchange[];
  }

  // Groups in first-appearance order, so the connect/discovery group sorts first — nothing stamps an
  // action before the page's first `beginAction` call, so it's always the group at index 0, which is
  // what the template below uses to collapse it by default without needing to name its label here.
  function groupByAction(list: WireExchange[]): Group[] {
    const groups: Group[] = [];
    const byAction = new Map<string, Group>();
    for (const exchange of list) {
      let group = byAction.get(exchange.action);
      if (!group) {
        group = { action: exchange.action, exchanges: [] };
        byAction.set(exchange.action, group);
        groups.push(group);
      }
      group.exchanges.push(exchange);
    }
    return groups;
  }

  const groups = $derived(groupByAction(exchanges));

  function pretty(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  function frameData(data: string): string {
    try {
      return pretty(JSON.parse(data));
    } catch {
      return data;
    }
  }

  // The one thing worth naming on a summary line beyond the method itself: the tool/resource/prompt
  // this exchange was about. Every method the page ever issues carries it as `params.name` (calls) or
  // `params.uri` (reads) — nothing here is guessing at a shape the SDK doesn't already commit to.
  function subject(exchange: WireExchange): string | null {
    const params = (exchange.requestBody as { params?: Record<string, unknown> } | undefined)
      ?.params;
    if (!params) return null;
    if (typeof params.name === "string") return params.name;
    if (typeof params.uri === "string") return params.uri;
    return null;
  }

  function statusText(exchange: WireExchange): string {
    return exchange.status ? `HTTP ${exchange.status}` : "sending…";
  }

  function contentTypeText(exchange: WireExchange): string {
    return exchange.pending ? "receiving…" : (exchange.contentType ?? "no body");
  }
</script>

{#if exchanges.length === 0}
  <p class="wire-empty">No requests yet — call a tool to see one here.</p>
{:else}
  <ol class="wire-groups">
    {#each groups as group, i (group.action)}
      <li class="wire-group">
        <details open={i > 0}>
          <summary>{group.action}</summary>
          <ol class="wire-log">
            {#each group.exchanges as exchange (exchange.id)}
              <li class="wire-exchange">
                <details>
                  <summary>
                    <span class="wire-method">{exchange.method}</span>
                    {#if subject(exchange)}
                      <span class="wire-subject">{subject(exchange)}</span>
                    {/if}
                    <span class="wire-status">{statusText(exchange)}</span>
                    <span class="wire-ct">{contentTypeText(exchange)}</span>
                  </summary>
                  <div class="wire-body">
                    <h3>Request</h3>
                    <p class="wire-url"><code>{exchange.url}</code></p>
                    <dl class="wire-headers">
                      {#each Object.entries(exchange.requestHeaders) as [name, value] (name)}
                        <dt>{name}</dt>
                        <dd>{value}</dd>
                      {/each}
                    </dl>
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex (WCAG 2.1.1: a scrollable region must be keyboard-reachable) -->
                    <pre class="wire-json" tabindex="0" aria-label="Request body">{pretty(
                        exchange.requestBody,
                      )}</pre>

                    <h3>Response</h3>
                    <dl class="wire-headers">
                      {#each Object.entries(exchange.responseHeaders) as [name, value] (name)}
                        <dt>{name}</dt>
                        <dd>{value}</dd>
                      {/each}
                    </dl>
                    {#if exchange.pending}
                      <p class="wire-pending">Waiting for the response body…</p>
                    {:else if exchange.frames.length > 0}
                      <ol class="wire-frames">
                        {#each exchange.frames as frame, fi (fi)}
                          <li>
                            <p class="wire-frame-event">event: {frame.event ?? "message"}</p>
                            <!-- svelte-ignore a11y_no_noninteractive_tabindex (WCAG 2.1.1: a scrollable region must be keyboard-reachable) -->
                            <pre class="wire-json" tabindex="0" aria-label="Frame data">{frameData(
                                frame.data,
                              )}</pre>
                          </li>
                        {/each}
                      </ol>
                    {:else}
                      <!-- svelte-ignore a11y_no_noninteractive_tabindex (WCAG 2.1.1: a scrollable region must be keyboard-reachable) -->
                      <pre class="wire-json" tabindex="0" aria-label="Response body">{pretty(
                          exchange.json,
                        )}</pre>
                    {/if}
                  </div>
                </details>
              </li>
            {/each}
          </ol>
        </details>
      </li>
    {/each}
  </ol>
{/if}
