<script lang="ts">
  import type { WireExchange } from "../hosts/browser";

  // Renders exactly what went over the wire: per exchange, the JSON-RPC method, status, request
  // headers/body, and either the response's JSON body or its decoded SSE frames in order. Every cue
  // (method text, "HTTP <code>", the frame count) is text, not color, so the log reads the same
  // without relying on the theme's contrast for meaning.
  //
  // Every `.wire-json` <pre> below carries `tabindex="0"`: it scrolls (see `.wire-json`'s
  // `overflow: auto` / `max-height` in styles.css), and WCAG 2.1.1/1.4.13 requires a scrollable
  // region to be keyboard-reachable — svelte-check's generic a11y heuristic flags a <pre> as
  // "noninteractive" and warns on this, but the warning is exactly backwards here.

  let { exchanges }: { exchanges: WireExchange[] } = $props();

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
</script>

{#if exchanges.length === 0}
  <p class="wire-empty">No requests yet — call a tool below to see one here.</p>
{:else}
  <ol class="wire-log">
    {#each exchanges as exchange, i (exchange.id)}
      <li class="wire-exchange">
        <details open={i === exchanges.length - 1}>
          <summary>
            <span class="wire-method">{exchange.method}</span>
            <span class="wire-status"
              >{exchange.status ? `HTTP ${exchange.status}` : "sending…"}</span
            >
            <span class="wire-ct">
              {exchange.pending ? "receiving…" : (exchange.contentType ?? "no body")}
            </span>
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
{/if}
