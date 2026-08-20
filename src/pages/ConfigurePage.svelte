<script lang="ts">
  import { fetchUrlDocument, type DocInput } from "../loader";
  import OadForm from "../ui/OadForm.svelte";
  import DocumentTypesSelect from "../ui/DocumentTypesSelect.svelte";
  import ResolutionOptions from "../ui/ResolutionOptions.svelte";
  import type { RenderOutcome, RenderOptions } from "../ui/oadForm";
  import { pipelineClient, PipelineCancelled } from "../app/pipelineClient";
  import { errorMessage } from "../errors";
  import { demos, type Demo } from "../app/demos";
  import { session, type McpRawDoc } from "../app/session.svelte";
  import { navigate } from "../app/router.svelte";
  import { viewPath, mcpPath } from "../app/viewUrl";
  import { type ViewerConfig, defaultConfig } from "../app/config";

  // The Configure page: choose document sources (the existing form) or a pre-built demo, set
  // resolution options, then route to the Explore page or the MCP page. Rendering to the Explore
  // page resolves online-URL and demo sources into the bookmarkable view URL directly; an upload is
  // resolved here (pipeline in a worker) and handed off in memory. Routing to the MCP page never runs
  // the pipeline at all — it wants document text, not a rendered OAD — so a URL-only source is handed
  // to McpPage as a bookmarkable request it fetches itself, and a source with an upload is
  // materialized to raw text and handed off in memory (see `handOffToMcp`). The resolution config is
  // applied at render and carried in the URL either way.
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

    if (destination === "mcp") {
      // A fresh click always supersedes whatever an earlier one left behind — otherwise a stale
      // upload handoff from a previous click could shadow this click's own (possibly URL-only)
      // source once McpPage prioritizes the handoff over its URL request.
      session.mcpDocs = null;
      if (docs) {
        // Bookmarkable and reload-proof: McpPage fetches these itself, so there's nothing to
        // resolve here, and nothing that would elicit ever gets blocked by a local pipeline run.
        navigate(mcpPath({ kind: "urls", docs }, config));
        return { ok: true };
      }
      return handOffToMcp(inputs);
    }

    if (docs) {
      navigate(viewPath({ kind: "urls", docs }, config));
      return { ok: true };
    }

    // Anything with an uploaded file can't live in a URL, so resolve it here — keeping per-row / OAD
    // errors inline on the form. The pipeline runs in a worker so the page stays responsive and the
    // load can be cancelled.
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
      navigate(viewPath({ kind: "session" }, config));
      return { ok: true };
    } catch (e) {
      if (e instanceof PipelineCancelled) return { ok: false, cancelled: true };
      return { ok: false, oadError: errorMessage(e) };
    } finally {
      busy = false;
    }
  }

  /**
   * Materialize a document set that includes at least one upload into raw text and hand it to
   * McpPage in memory — no pipeline run, since the tool wants document text, not a rendered OAD.
   * Every upload already carries its text (the form read it at file-select time); a URL row mixed
   * into the same set is fetched here with the same acquisition `loader.ts`'s own url branch uses,
   * so a failed fetch surfaces as the usual per-row form error rather than a broken /mcp navigation.
   */
  async function handOffToMcp(inputs: DocInput[]): Promise<RenderOutcome> {
    busy = true;
    try {
      const docs: McpRawDoc[] = [];
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i]!;
        if (input.source === "upload") {
          docs.push({
            filename: input.filename,
            text: input.text,
            retrievalUri: input.retrievalUri,
            isEntry: input.isEntry,
          });
          continue;
        }
        try {
          const doc = await fetchUrlDocument(input);
          docs.push({
            filename: doc.filename ?? input.url,
            text: doc.text,
            retrievalUri: doc.retrievalUri,
            isEntry: input.isEntry,
          });
        } catch (e) {
          return { ok: false, rowErrors: { [i]: errorMessage(e) } };
        }
      }
      session.mcpDocs = { docs, config: $state.snapshot(config), request: { kind: "session" } };
      navigate(mcpPath(null, config));
      return { ok: true };
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
      <!-- Document-type selector, above the documents it governs. -->
      <DocumentTypesSelect bind:config />
      <OadForm {onRender} />
    </div>

    <div class="resolution-box">
      <ResolutionOptions bind:config />
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
