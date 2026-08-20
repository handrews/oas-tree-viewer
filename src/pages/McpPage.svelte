<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { ViewRequest } from "../app/viewUrl";
  import type { ViewerConfig } from "../app/config";
  import type { Severity } from "../diagnostics/types";
  import type { Tool, Resource, Prompt, CallToolResult } from "@modelcontextprotocol/client";
  import type { McpBrowserHost, WireExchange, PendingElicit } from "../mcp/hosts/browser";
  import type { InlineDoc } from "../mcp/documents";
  import { fetchUrlDocument } from "../loader";
  import { session } from "../app/session.svelte";
  import { navigate } from "../app/router.svelte";
  import { mcpPath, viewPath } from "../app/viewUrl";
  import { demos, demoById } from "../app/demos";
  import { TOOL_NAMES, MAX_INLINE_DOCS, MAX_DOC_CHARS, CONNECT_ACTION } from "../mcp/info";
  import { inlineDocsFromOad } from "../mcp/fromOad";
  import { errorMessage } from "../errors";
  import DocumentTypesSelect from "../ui/DocumentTypesSelect.svelte";
  import ResolutionOptions from "../ui/ResolutionOptions.svelte";
  import WireLog from "../mcp/ui/WireLog.svelte";
  import ArgsForm from "../mcp/ui/ArgsForm.svelte";
  import ElicitPanel from "../mcp/ui/ElicitPanel.svelte";

  // The MCP demo page: connects a real Client to the server in-page (hosts/browser.ts, imported
  // dynamically so the SDK + zod land in a leaf chunk — see App.svelte), analyzes whatever source is
  // available, and shows the real capability list, arguments form, wire log, and result for any tool
  // call. In priority order: `session.mcpDocs`, a raw-docs handoff from ConfigurePage's MCP-native
  // "Try it over MCP" for a source that included an upload (highest — the freshest, most deliberate
  // action); `session.current`, written by ViewPage for whatever's on the current view; a `demo=` URL
  // request; and a `doc=` URL request, which this page fetches itself (raw text only — no pipeline
  // run, since the tool wants document text, not a rendered OAD). A bare demo/doc URL is what survives
  // a reload, when both session fields are empty.
  //
  // Laid out as a workbench: the left column is the action side (source, tool call, result — the
  // elicitation panel included, since an `input_required` reply is semantically the call's result);
  // the right column is a sticky wire log, so every left-hand action visibly produces traffic on the
  // right without scrolling. Capabilities — the server's advertised surface, not something you act on
  // — sits collapsed below both, out of the way until asked for.

  // Not imported from the SDK: `ListResourceTemplatesResult`'s item type is a bare zod inference with
  // no exported name. Only the two fields the capability panel shows are needed here.
  interface ResourceTemplateSummary {
    name: string;
    uriTemplate: string;
  }

  /** `ttlMs`/`cacheScope` come back as `unknown` on the SDK's inferred result types (a forward-compat
   *  cache-hint decoration the static zod schema doesn't model); both are numbers/strings on the wire
   *  (confirmed against a real call — see hosts/browser.ts's header). */
  function cacheHint(result: Record<string, unknown>): { ttlMs?: number; cacheScope?: string } {
    return {
      ttlMs: result.ttlMs as number | undefined,
      cacheScope: result.cacheScope as string | undefined,
    };
  }

  // A demo-document resource (`oas://demo/{demoId}/{filename}`) is the one sublist long enough (25 of
  // the 53 total resources) to need truncating behind an expander — everything else the capabilities
  // panel lists is short enough to show in full.
  function isDemoDocUri(uri: string): boolean {
    return /^oas:\/\/demo\/[^/]+\/[^/]+$/.test(uri);
  }
  const DEMO_DOC_PREVIEW = 8;

  let { request, config }: { request: ViewRequest | null; config: ViewerConfig } = $props();

  type Source =
    | { kind: "demo"; demoId: string; label: string }
    | {
        kind: "inline";
        docs: InlineDoc[];
        entry: string;
        /** The /view equivalent for this source, when one exists — what the "Render OAD" back-link
         *  navigates to. Null for a raw-docs handoff: nothing was ever resolved into `session.result`,
         *  so /view would just show its empty state. */
        view: { request: ViewRequest; config: ViewerConfig } | null;
      };

  // A `kind: "urls"` request's raw text, fetched by this page itself (see the effect below) — null
  // both before the fetch starts and once a fresher source (a handoff or session.current) makes it
  // irrelevant, so `source` doesn't need to separately track "was this fetch even for this request".
  let fetchedDocs = $state<InlineDoc[] | null>(null);
  let fetchError = $state<string | null>(null);
  let fetching = $state(false);

  // Fetches a `urls` request's documents itself — the one case with no in-memory handoff and nothing
  // already loaded (a bookmarked/reloaded /mcp?doc=…, or Configure's URL-only "Try it over MCP", which
  // never runs a pipeline at all). A handoff or `session.current` is always fresher when present (see
  // `source`'s priority below), so this only ever does real work when both are absent.
  $effect(() => {
    if (session.mcpDocs || session.current || request?.kind !== "urls") {
      fetchedDocs = null;
      fetchError = null;
      fetching = false;
      return;
    }
    const docsReq = request.docs;
    let cancelled = false;
    fetching = true;
    fetchError = null;
    fetchedDocs = null;
    void (async () => {
      try {
        const docs: InlineDoc[] = [];
        for (const d of docsReq) {
          const acquired = await fetchUrlDocument({
            source: "url",
            url: d.url,
            isEntry: d.isEntry,
          });
          docs.push({
            filename: acquired.filename ?? d.url,
            text: acquired.text,
            retrievalUri: acquired.retrievalUri,
            isEntry: d.isEntry,
          });
        }
        if (!cancelled) fetchedDocs = docs;
      } catch (e) {
        if (!cancelled) fetchError = errorMessage(e);
      } finally {
        if (!cancelled) fetching = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const source = $derived.by((): Source | null => {
    // A raw-docs handoff is the freshest, most deliberate action (just clicked on Configure), so it
    // outranks even `session.current` — otherwise a stale current view could shadow the upload set
    // this navigation was actually for.
    const handoff = session.mcpDocs;
    if (handoff) {
      const entry =
        handoff.docs.find((d) => d.isEntry)?.filename ?? handoff.docs[0]?.filename ?? "?";
      return { kind: "inline", docs: handoff.docs, entry, view: null };
    }
    const current = session.current;
    if (current) {
      if (current.request.kind === "demo") {
        const demoId = current.request.demoId;
        return { kind: "demo", demoId, label: demoById(demoId)?.label ?? demoId };
      }
      const docs = inlineDocsFromOad(current.oad);
      const entry = docs.find((d) => d.isEntry)?.filename ?? docs[0]?.filename ?? "?";
      return {
        kind: "inline",
        docs,
        entry,
        view: { request: current.request, config: current.config },
      };
    }
    if (request?.kind === "demo") {
      return {
        kind: "demo",
        demoId: request.demoId,
        label: demoById(request.demoId)?.label ?? request.demoId,
      };
    }
    if (request?.kind === "urls" && fetchedDocs) {
      const entry = fetchedDocs.find((d) => d.isEntry)?.filename ?? fetchedDocs[0]?.filename ?? "?";
      return { kind: "inline", docs: fetchedDocs, entry, view: { request, config } };
    }
    return null;
  });

  const overLimit = $derived(
    source?.kind === "inline" &&
      (source.docs.length > MAX_INLINE_DOCS ||
        source.docs.reduce((n, d) => n + d.text.length, 0) > MAX_DOC_CHARS),
  );

  // Where this run's inline documents came from, for the source strip's sentence — a handoff and a
  // freshly-fetched `urls` request both produce `session.current === null`, so that alone can't tell
  // them apart.
  const inlineOrigin = $derived(
    session.mcpDocs ? "the configure page" : session.current ? "the current view" : "this link",
  );

  // Seeds the arguments form's `config` field with whatever produced the current source, so the form
  // starts in step with what's on screen (or was just handed off) rather than the tool's bare schema
  // defaults — and, under analyze.ts's config precedence, is what makes a strict "Document types"
  // choice here actually elicit on the fragment demo.
  const configSeed = $derived(session.mcpDocs?.config ?? session.current?.config ?? config);

  let host = $state<McpBrowserHost | null>(null);
  let wireLog = $state<WireExchange[]>([]);
  let connecting = $state(true);
  let connectError = $state<string | null>(null);
  let pendingElicit = $state<PendingElicit | null>(null);

  let tools = $state<{ items: Tool[]; ttlMs?: number; cacheScope?: string } | null>(null);
  let resources = $state<{ items: Resource[]; ttlMs?: number; cacheScope?: string } | null>(null);
  let resourceTemplates = $state<{
    items: ResourceTemplateSummary[];
    ttlMs?: number;
    cacheScope?: string;
  } | null>(null);
  let prompts = $state<{ items: Prompt[]; ttlMs?: number; cacheScope?: string } | null>(null);
  let showAllDemoDocs = $state(false);
  // Bound to the capabilities <details> (see the template below) so the wire log's connect-group
  // summary link can open it programmatically, not just toggle it via a click on <summary> itself.
  let capsOpen = $state(false);
  // Split once here rather than with an inline `{@const}` per list — the capabilities panel renders
  // the two groups (everything else, then the truncatable demo-document sublist) separately.
  const otherResources = $derived(resources?.items.filter((r) => !isDemoDocUri(r.uri)) ?? []);
  const demoDocResources = $derived(resources?.items.filter((r) => isDemoDocUri(r.uri)) ?? []);

  let selectedToolName = $state<string>(TOOL_NAMES.analyzeDocument);
  const selectedTool = $derived(tools?.items.find((t) => t.name === selectedToolName) ?? null);

  // analyze-document's arguments, collected by the same shared widgets the Configure page uses
  // (DocumentTypesSelect, ResolutionOptions) rather than a schema-generated ArgsForm — seeded once
  // from configSeed, same as the form's old `initial` prop was (and, like ArgsForm's own `values`,
  // `untrack`ed to mark that one-time read as deliberate rather than a lost reactive dependency).
  // explain-diagnostic's one argument still goes through ArgsForm below, with its own independent
  // `requestProgress`.
  let mcpConfig = $state<ViewerConfig>(untrack(() => configSeed));
  let minSeverity = $state<Severity>("info");
  let requestProgress = $state(true);

  let result = $state<CallToolResult | null>(null);
  let callError = $state<string | null>(null);
  let calling = $state(false);

  async function loadCapabilities(
    h: McpBrowserHost,
    opts: { refresh?: boolean } = {},
  ): Promise<void> {
    if (opts.refresh) h.beginAction("Refresh capabilities");
    const cacheMode = opts.refresh ? ("refresh" as const) : undefined;
    const [t, r, rt, p] = await Promise.all([
      h.client.listTools(undefined, { cacheMode }),
      h.client.listResources(undefined, { cacheMode }),
      h.client.listResourceTemplates(undefined, { cacheMode }),
      h.client.listPrompts(undefined, { cacheMode }),
    ]);
    tools = { items: t.tools, ...cacheHint(t) };
    resources = { items: r.resources, ...cacheHint(r) };
    resourceTemplates = { items: rt.resourceTemplates, ...cacheHint(rt) };
    prompts = { items: p.prompts, ...cacheHint(p) };
  }

  $effect(() => {
    let cancelled = false;
    let opened: McpBrowserHost | null = null;
    void (async () => {
      const { McpBrowserHost: HostCtor } = await import("../mcp/hosts/browser");
      if (cancelled) return;
      const h = new HostCtor(
        (log) => (wireLog = log),
        (pending) => (pendingElicit = pending),
      );
      opened = h;
      host = h;
      try {
        await h.connected;
        if (cancelled) return;
        await loadCapabilities(h);
      } catch (e) {
        if (!cancelled) connectError = errorMessage(e);
      } finally {
        if (!cancelled) connecting = false;
      }
    })();
    return () => {
      cancelled = true;
      pendingElicit = null;
      void opened?.close();
    };
  });

  async function callTool(
    args: Record<string, unknown>,
    opts: { requestProgress: boolean },
  ): Promise<void> {
    if (!host || !selectedTool) return;
    host.beginAction(`Call ${selectedTool.title ?? selectedTool.name}`);
    calling = true;
    callError = null;
    result = null;
    const sourceArgs =
      selectedTool.name === TOOL_NAMES.analyzeDocument
        ? source?.kind === "demo"
          ? { demo: source.demoId }
          : source?.kind === "inline"
            ? { documents: source.docs }
            : {}
        : {};
    try {
      result = await host.client.callTool(
        { name: selectedTool.name, arguments: { ...sourceArgs, ...args } },
        opts.requestProgress ? { onprogress: () => {} } : undefined,
      );
    } catch (e) {
      callError = errorMessage(e);
    } finally {
      calling = false;
    }
  }

  /** analyze-document's own Call tool button (see the template below) — its arguments come straight
   *  from the shared config widgets' state, with no form/submit event in the loop. */
  function submitAnalyzeCall(): void {
    void callTool({ config: $state.snapshot(mcpConfig), minSeverity }, { requestProgress });
  }

  // The connect group's summary must read exactly as CONNECT_ACTION (see WireLog.svelte's index-0
  // grouping) even with its last word styled as a link — split from the constant itself, rather than
  // hand-copied, so wording and link text can't drift apart.
  const CONNECT_LINK_TEXT = "capabilities";
  const CONNECT_PREFIX = CONNECT_ACTION.slice(0, -CONNECT_LINK_TEXT.length);

  /** The wire log's connect-group summary triggers this on click. Deliberately a plain `<span>`, not
   *  an `<a>`/`<button>` (see the template below): a `<summary>` is itself a focusable control, and
   *  axe's nested-interactive check (WCAG 4.1.2) flags any focusable descendant of one — even with
   *  `tabindex="-1"`, since assistive tech can still reach it. The capabilities panel stays fully
   *  keyboard-reachable on its own (it's a `<details>` further down the page); this is a mouse/touch
   *  shortcut to it, not the only path — so trading its keyboard-focusability away here is safe.
   *  The wire group's own `<details>` sits right above this click in the DOM: `preventDefault` stops
   *  the browser's native summary-click toggle (gated on the event's defaultPrevented flag, not on
   *  propagation), and `stopPropagation` stops it from reaching any ancestor listener too. */
  async function openCapabilities(e: MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    capsOpen = true;
    await tick();
    document.getElementById("mcp-capabilities")?.scrollIntoView({ behavior: "smooth" });
  }

  async function readLink(uri: string): Promise<void> {
    if (!host) return;
    host.beginAction(`Read ${uri}`);
    try {
      await host.client.readResource({ uri });
    } catch (e) {
      callError = errorMessage(e);
    }
  }

  // A raw-docs handoff has no /view equivalent (nothing was ever resolved into `session.result`, so
  // /view would just show its empty state); the cold picker has nothing to render either — so the
  // round trip back to the explorer only makes sense for a demo or an inline source with a `view`.
  const canOpenView = $derived(
    source?.kind === "demo" || (source?.kind === "inline" && !!source.view),
  );

  function openView(): void {
    if (source?.kind === "demo") {
      navigate(
        viewPath({ kind: "demo", demoId: source.demoId }, session.current?.config ?? config),
      );
    } else if (source?.kind === "inline" && source.view) {
      navigate(viewPath(source.view.request, source.view.config));
    }
  }
</script>

<section class="mcp-page" aria-label="Try it over MCP">
  <h2>Try it over MCP</h2>

  {#if !source && !fetching && !fetchError}
    <section aria-labelledby="mcp-picker-heading">
      <h2 id="mcp-picker-heading">Choose a demo to analyze</h2>
      <ul class="demo-list">
        {#each demos as demo (demo.id)}
          <li class="demo-item">
            <button
              type="button"
              class="demo-open"
              onclick={() => navigate(mcpPath({ kind: "demo", demoId: demo.id }, config))}
            >
              {demo.label}
            </button>
            <p class="demo-desc">{demo.description}</p>
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <section class="mcp-source-section">
      <p class="mcp-source-strip">
        {#if fetching}
          Fetching documents…
        {:else if fetchError}
          <span class="mcp-error" role="alert">{fetchError}</span>
        {:else if source?.kind === "demo"}
          MCP interface for demo &quot;{source.label}&quot; · {session.current
            ? "from the current view"
            : "from this link"}
        {:else if source?.kind === "inline"}
          MCP interface for: {source.entry} · {source.docs.length} document{source.docs.length === 1
            ? ""
            : "s"} · from {inlineOrigin}
        {/if}
        {#if canOpenView}
          <button type="button" class="mcp-view-open" onclick={openView}>Render OAD</button>
        {/if}
      </p>
      {#if source?.kind === "inline" && overLimit}
        <p class="mcp-limit-refusal" role="alert">
          This view has {source.docs.length} documents, which is too much to analyze inline here (the
          tool caps inline input at {MAX_INLINE_DOCS} documents / {MAX_DOC_CHARS.toLocaleString()} characters
          total). Try a bundled demo instead.
        </p>
      {/if}
    </section>

    {#if source}
      {#if connecting}
        <p role="status">Connecting to the MCP server…</p>
      {:else if connectError}
        <p class="mcp-error" role="alert">{connectError}</p>
      {:else}
        <div class="mcp-workbench">
          <div class="mcp-workbench-main">
            {#if !overLimit}
              <section class="mcp-call-section" aria-labelledby="mcp-call-heading">
                <h2 id="mcp-call-heading">Call a tool</h2>
                <div class="config-group">
                  <div class="doc-region">
                    {#if selectedTool?.name === TOOL_NAMES.analyzeDocument}
                      <DocumentTypesSelect bind:config={mcpConfig} />
                    {/if}
                    <label class="load-behavior-field">
                      <span class="load-behavior-label">Tool</span>
                      <select class="load-behavior" bind:value={selectedToolName}>
                        {#each tools?.items ?? [] as t (t.name)}
                          <option value={t.name}>{t.title ?? t.name}</option>
                        {/each}
                      </select>
                    </label>
                    {#if selectedTool?.name === TOOL_NAMES.analyzeDocument}
                      <label class="option">
                        <span class="option-label">Minimum severity</span>
                        <select class="option-select" bind:value={minSeverity}>
                          <option value="error">error</option>
                          <option value="warning">warning</option>
                          <option value="info">info</option>
                        </select>
                      </label>
                    {/if}
                  </div>

                  {#if selectedTool?.name === TOOL_NAMES.analyzeDocument}
                    <div class="resolution-box">
                      <ResolutionOptions bind:config={mcpConfig} />
                      <div class="render-actions">
                        <button
                          type="button"
                          class="render"
                          disabled={calling}
                          onclick={submitAnalyzeCall}
                        >
                          Call tool
                        </button>
                        <label class="args-label args-checkbox args-progress">
                          <input type="checkbox" bind:checked={requestProgress} />
                          <span>Request progress</span>
                        </label>
                      </div>
                    </div>
                  {:else if selectedTool}
                    {#key selectedTool.name}
                      <ArgsForm tool={selectedTool} onsubmit={callTool} />
                    {/key}
                  {/if}
                </div>
              </section>
            {/if}

            <section class="mcp-result-section" aria-labelledby="mcp-result-heading">
              <h2 id="mcp-result-heading">Result</h2>
              {#if pendingElicit}
                <h3 id="mcp-elicit-heading">The server needs more information</h3>
                <ElicitPanel
                  message={pendingElicit.message}
                  requestedSchema={pendingElicit.requestedSchema}
                  onRespond={(response) => pendingElicit?.respond(response)}
                />
              {:else if calling}
                <p role="status">Calling {selectedTool?.name}…</p>
              {:else if callError}
                <p class="mcp-error" role="alert">{callError}</p>
              {:else if result}
                {#if result.isError}
                  <p class="mcp-result-error" role="alert">
                    The tool returned an error — see the text below.
                  </p>
                {/if}
                {#each result.content as block, i (i)}
                  {#if block.type === "text"}
                    <pre class="mcp-result-text">{block.text}</pre>
                  {:else if block.type === "resource_link"}
                    <button
                      type="button"
                      class="mcp-resource-link"
                      onclick={() => readLink(block.uri)}
                    >
                      {block.name ?? block.uri}
                    </button>
                  {/if}
                {/each}
                {#if result.structuredContent}
                  <details class="mcp-structured">
                    <summary>Structured content</summary>
                    <pre>{JSON.stringify(result.structuredContent, null, 2)}</pre>
                  </details>
                {/if}
              {:else}
                <p class="mcp-result-empty">Call a tool above to see the result here.</p>
              {/if}
            </section>
          </div>

          <!-- svelte-ignore a11y_no_noninteractive_tabindex (WCAG 2.1.1: a scrollable region must be keyboard-reachable, matching WireLog.svelte's own .wire-json panes) -->
          <div class="mcp-workbench-wire" tabindex="0" aria-labelledby="mcp-wire-heading">
            <section>
              <h2 id="mcp-wire-heading">Wire log</h2>
              <WireLog exchanges={wireLog}>
                {#snippet connectSummary()}
                  <!-- The span (not a link/button — see openCapabilities's comment) must sit right
                       after the text with no whitespace between, so the rendered summary reads as one
                       CONNECT_ACTION-matching string. -->
                  {CONNECT_PREFIX}<!-- svelte-ignore a11y_no_static_element_interactions --><!-- svelte-ignore a11y_click_events_have_key_events --><span
                    class="wire-connect-link"
                    onclick={openCapabilities}>{CONNECT_LINK_TEXT}</span
                  >
                {/snippet}
              </WireLog>
            </section>
          </div>
        </div>

        <details class="mcp-caps-details" id="mcp-capabilities" bind:open={capsOpen}>
          <summary>
            Capabilities — the server's advertised surface, discovered over MCP at connect (<code
              >tools/list</code
            >, <code>resources/list</code>,
            <code>resources/templates/list</code>, <code>prompts/list</code>)
          </summary>
          <div class="mcp-caps-body">
            <div class="mcp-caps-header">
              <button
                type="button"
                class="mcp-refresh"
                disabled={!host}
                onclick={() => host && loadCapabilities(host, { refresh: true })}
              >
                Refresh
              </button>
            </div>
            <div class="mcp-caps-grid">
              <div class="mcp-caps-col">
                <h3>Tools</h3>
                {#if tools}
                  <p class="mcp-cache-note">
                    ttl {tools.ttlMs ?? 0}ms · {tools.cacheScope ?? "private"}
                  </p>
                  <ul>
                    {#each tools.items as t (t.name)}
                      <li><code>{t.name}</code></li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <div class="mcp-caps-col">
                <h3>Resources</h3>
                {#if resources}
                  <p class="mcp-cache-note">
                    ttl {resources.ttlMs ?? 0}ms · {resources.cacheScope ?? "private"}
                  </p>
                  <ul>
                    {#each otherResources as r (r.uri)}
                      <li><code>{r.uri}</code></li>
                    {/each}
                    {#each demoDocResources.slice(0, showAllDemoDocs ? demoDocResources.length : DEMO_DOC_PREVIEW) as r (r.uri)}
                      <li><code>{r.uri}</code></li>
                    {/each}
                    {#if !showAllDemoDocs && demoDocResources.length > DEMO_DOC_PREVIEW}
                      <li>
                        <button
                          type="button"
                          class="mcp-caps-more"
                          onclick={() => (showAllDemoDocs = true)}
                        >
                          …and {demoDocResources.length - DEMO_DOC_PREVIEW} more
                        </button>
                      </li>
                    {/if}
                  </ul>
                {/if}
              </div>
              <div class="mcp-caps-col">
                <h3>Resource templates</h3>
                {#if resourceTemplates}
                  <p class="mcp-cache-note">
                    ttl {resourceTemplates.ttlMs ?? 0}ms · {resourceTemplates.cacheScope ??
                      "private"}
                  </p>
                  <ul>
                    {#each resourceTemplates.items as t (t.name)}
                      <li><code>{t.uriTemplate}</code></li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <div class="mcp-caps-col">
                <h3>Prompts</h3>
                {#if prompts}
                  <p class="mcp-cache-note">
                    ttl {prompts.ttlMs ?? 0}ms · {prompts.cacheScope ?? "private"}
                  </p>
                  <ul>
                    {#each prompts.items as p (p.name)}
                      <li><code>{p.name}</code></li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </div>
          </div>
        </details>
      {/if}
    {/if}
  {/if}
</section>
