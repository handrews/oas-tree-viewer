<script lang="ts">
  import type { DocInput } from "../loader";
  import OadForm from "../ui/OadForm.svelte";
  import type { RenderOutcome, RenderOptions } from "../ui/oadForm";
  import { pipelineClient, PipelineCancelled } from "../app/pipelineClient";
  import { errorMessage } from "../errors";
  import { demos, type Demo } from "../app/demos";
  import { session } from "../app/session.svelte";
  import { navigate } from "../app/router.svelte";
  import { viewPath, mcpPath, type ViewRequest } from "../app/viewUrl";
  import { type ViewerConfig, defaultConfig } from "../app/config";
  import { FRAGMENTS_CONTROL_LABEL, FRAGMENTS_OPTIONS } from "../app/fragmentsText";

  // The Configure page: choose document sources (the existing form) or a pre-built demo,
  // set resolution options, then route to the Explore page. Online-URL and demo renders
  // encode fully into the view URL (bookmarkable); upload renders are resolved here and
  // handed off in memory. The resolution config is applied at render and carried in the URL.
  let config = $state<ViewerConfig>({ ...defaultConfig });
  // True while an upload render is running in the worker; flips the Render button to Cancel.
  let busy = $state(false);
  // Which button was clicked, read (and relied on) once onRender fires. Click precedes submit, so
  // this is always current by the time the form's submit handler calls onRender.
  let destination = $state<"view" | "mcp">("view");

  /** Url-only inputs can be encoded straight into a `urls` request; anything with an uploaded file
   *  can't, and must be resolved to get a bookmarkable equivalent for /mcp. */
  function urlDocs(inputs: DocInput[]): { url: string; isEntry: boolean }[] | null {
    if (!inputs.every((i) => i.source === "url")) return null;
    return inputs.flatMap((i) => (i.source === "url" ? [{ url: i.url, isEntry: i.isEntry }] : []));
  }

  async function onRender(inputs: DocInput[], opts: RenderOptions = {}): Promise<RenderOutcome> {
    const docs = urlDocs(inputs);
    if (destination === "view" && docs) {
      navigate(viewPath({ kind: "urls", docs }, config));
      return { ok: true };
    }
    // Anything with an uploaded file can't live in a URL, so resolve it here — keeping per-row / OAD
    // errors inline on the form. Routing to /mcp also resolves here even for url-only inputs: McpPage
    // prefers `session.current` over its own URL request, so navigating there with a stale
    // `session.current` would analyze the wrong documents — it must be refreshed first. The pipeline
    // runs in a worker so the page stays responsive and the load can be cancelled.
    busy = true;
    try {
      // `inputs` (the form may hand back its reactive `lastInputs` on a "Load anyway" retry) and
      // `config` are reactive ($state proxies); snapshot them to plain objects so they can be
      // structured-cloned across the worker boundary (a proxy can't).
      const configSnapshot = $state.snapshot(config);
      const result = await pipelineClient.run($state.snapshot(inputs), configSnapshot, opts);
      if (!result.ok)
        return {
          ok: false,
          rowErrors: result.rowErrors,
          oadError: result.oadError,
          limited: result.limited,
        };
      session.result = {
        oad: result.oad,
        refs: result.refs,
        diagnostics: result.diagnostics,
      };
      if (destination === "mcp") {
        const request: ViewRequest = docs ? { kind: "urls", docs } : { kind: "session" };
        session.current = {
          oad: result.oad,
          diagnostics: result.diagnostics,
          config: configSnapshot,
          request,
        };
        navigate(mcpPath(request.kind === "urls" ? request : null, config));
        return { ok: true };
      }
      navigate(viewPath({ kind: "session" }, config));
      return { ok: true };
    } catch (e) {
      if (e instanceof PipelineCancelled) return { ok: false, cancelled: true };
      return { ok: false, oadError: errorMessage(e) };
    } finally {
      busy = false;
    }
  }

  /** Abort an in-flight upload render (terminates the worker). */
  function cancelRender(): void {
    pipelineClient.cancel();
  }

  // A demo may carry a config override (e.g. enabling fragments), merged over the current options so
  // the demo opens in the mode it needs — and that mode is carried in the bookmarkable view URL.
  function openDemo(demo: Demo): void {
    navigate(viewPath({ kind: "demo", demoId: demo.id }, { ...config, ...demo.config }));
  }
</script>

<section id="input-panel" aria-label="OAD input">
  <div class="config-group">
    <div class="doc-region">
      <!-- Document-type selector, labeled to its left, above the documents it governs. The visible
           "Document types" text is the select's accessible name (so no aria-label). -->
      <label class="load-behavior-field">
        <span class="load-behavior-label">{FRAGMENTS_CONTROL_LABEL}</span>
        <select class="load-behavior" bind:value={config.fragments}>
          {#each FRAGMENTS_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
      <OadForm {onRender} />
    </div>

    <div class="resolution-box">
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
      <!-- Sits inside the options box and on its header line (shown whether the box is open or closed),
         but is a sibling of <details> rather than nested in <summary> — nesting interactive controls is
         a serious a11y violation. Both buttons submit the OadForm by its id; each sets `destination`
         on click (before the submit event fires) so onRender knows where to send the result, and
         Render OAD stays first in DOM so it remains the form's default submit button. While a render
         is running both are disabled and a Cancel button (aborting the worker) sits beside them. -->
      <div class="render-actions">
        <button
          type="submit"
          form="oad-form"
          class="render"
          disabled={busy}
          onclick={() => (destination = "view")}
        >
          {busy ? "Loading…" : "Render OAD"}
        </button>
        <button
          type="submit"
          form="oad-form"
          class="mcp-open"
          disabled={busy}
          onclick={() => (destination = "mcp")}
        >
          Try it over MCP
        </button>
        {#if busy}
          <button type="button" class="render-cancel" onclick={cancelRender}>Cancel</button>
        {/if}
      </div>
    </div>
  </div>

  <section class="demos" aria-label="Example documents">
    <h2>Or explore an example</h2>
    <ul class="demo-list">
      {#each demos as demo (demo.id)}
        <li class="demo-item">
          <button type="button" class="demo-open" onclick={() => openDemo(demo)}>
            {demo.label}
          </button>
          <p class="demo-desc">{demo.description}</p>
        </li>
      {/each}
    </ul>
  </section>
</section>
