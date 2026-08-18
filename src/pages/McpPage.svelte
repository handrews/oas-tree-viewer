<script lang="ts">
  import type { ViewRequest } from "../app/viewUrl";
  import type { ViewerConfig } from "../app/config";
  import type { Tool, Resource, Prompt, CallToolResult } from "@modelcontextprotocol/client";
  import type { McpBrowserHost, WireExchange } from "../mcp/hosts/browser";
  import { session } from "../app/session.svelte";
  import { navigate } from "../app/router.svelte";
  import { mcpPath } from "../app/viewUrl";
  import { demos, demoById } from "../app/demos";
  import { TOOL_NAMES, MAX_INLINE_DOCS, MAX_DOC_CHARS } from "../mcp/info";
  import { inlineDocsFromOad } from "../mcp/fromOad";
  import { errorMessage } from "../errors";
  import WireLog from "../mcp/ui/WireLog.svelte";
  import ArgsForm from "../mcp/ui/ArgsForm.svelte";

  // The MCP demo page: connects a real Client to the server in-page (hosts/browser.ts, imported
  // dynamically so the SDK + zod land in a leaf chunk — see App.svelte), analyzes whatever is on the
  // current view (or a demo picked here), and shows the real capability list, arguments form, wire
  // log, and result for any tool call. `session.current` (written by ViewPage) is the only way to see
  // an uploaded/URL-loaded OAD; a bare demo id in the URL survives a reload, when the session is empty.

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

  let { request, config }: { request: ViewRequest | null; config: ViewerConfig } = $props();

  type Source =
    | { kind: "demo"; demoId: string; label: string }
    | { kind: "inline"; docs: ReturnType<typeof inlineDocsFromOad>; entry: string };

  const source = $derived.by((): Source | null => {
    const current = session.current;
    if (current) {
      if (current.request.kind === "demo") {
        const demoId = current.request.demoId;
        return { kind: "demo", demoId, label: demoById(demoId)?.label ?? demoId };
      }
      const docs = inlineDocsFromOad(current.oad);
      const entry = docs.find((d) => d.isEntry)?.filename ?? docs[0]?.filename ?? "?";
      return { kind: "inline", docs, entry };
    }
    if (request?.kind === "demo") {
      return {
        kind: "demo",
        demoId: request.demoId,
        label: demoById(request.demoId)?.label ?? request.demoId,
      };
    }
    return null;
  });

  const overLimit = $derived(
    source?.kind === "inline" &&
      (source.docs.length > MAX_INLINE_DOCS ||
        source.docs.reduce((n, d) => n + d.text.length, 0) > MAX_DOC_CHARS),
  );

  // Seeds the arguments form's `config` field with whatever the current view actually used, so the
  // form starts in step with what's on screen rather than the tool's bare schema defaults.
  const configSeed = $derived(session.current?.config ?? config);

  let host = $state<McpBrowserHost | null>(null);
  let wireLog = $state<WireExchange[]>([]);
  let connecting = $state(true);
  let connectError = $state<string | null>(null);

  let tools = $state<{ items: Tool[]; ttlMs?: number; cacheScope?: string } | null>(null);
  let resources = $state<{ items: Resource[]; ttlMs?: number; cacheScope?: string } | null>(null);
  let resourceTemplates = $state<{
    items: ResourceTemplateSummary[];
    ttlMs?: number;
    cacheScope?: string;
  } | null>(null);
  let prompts = $state<{ items: Prompt[]; ttlMs?: number; cacheScope?: string } | null>(null);

  let selectedToolName = $state<string>(TOOL_NAMES.analyzeDocument);
  const selectedTool = $derived(tools?.items.find((t) => t.name === selectedToolName) ?? null);

  let result = $state<CallToolResult | null>(null);
  let callError = $state<string | null>(null);
  let calling = $state(false);

  async function loadCapabilities(
    h: McpBrowserHost,
    opts: { refresh?: boolean } = {},
  ): Promise<void> {
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
      const h = new HostCtor((log) => (wireLog = log));
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
      void opened?.close();
    };
  });

  async function callTool(
    args: Record<string, unknown>,
    opts: { requestProgress: boolean },
  ): Promise<void> {
    if (!host || !selectedTool) return;
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

  async function readLink(uri: string): Promise<void> {
    if (!host) return;
    try {
      await host.client.readResource({ uri });
    } catch (e) {
      callError = errorMessage(e);
    }
  }
</script>

<section class="mcp-page" aria-label="Try it over MCP">
  <h2>Try it over MCP</h2>

  {#if !source}
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
    <p class="mcp-source-strip">
      {#if source.kind === "demo"}
        Analyzing demo &quot;{source.label}&quot; · {session.current
          ? "from the current view"
          : "from this link"}
      {:else}
        Analyzing: {source.entry} · {source.docs.length} document{source.docs.length === 1
          ? ""
          : "s"} · from the current view
      {/if}
    </p>
    {#if source.kind === "inline" && overLimit}
      <p class="mcp-limit-refusal" role="alert">
        This view has {source.docs.length} documents, which is too much to analyze inline here (the tool
        caps inline input at {MAX_INLINE_DOCS} documents / {MAX_DOC_CHARS.toLocaleString()} characters
        total). Try a bundled demo instead.
      </p>
    {/if}
  {/if}

  {#if connecting}
    <p role="status">Connecting to the MCP server…</p>
  {:else if connectError}
    <p class="mcp-error" role="alert">{connectError}</p>
  {:else}
    <section aria-labelledby="mcp-caps-heading">
      <div class="mcp-caps-header">
        <h2 id="mcp-caps-heading">Capabilities</h2>
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
            <p class="mcp-cache-note">ttl {tools.ttlMs ?? 0}ms · {tools.cacheScope ?? "private"}</p>
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
              {#each resources.items as r (r.uri)}
                <li><code>{r.uri}</code></li>
              {/each}
            </ul>
          {/if}
        </div>
        <div class="mcp-caps-col">
          <h3>Resource templates</h3>
          {#if resourceTemplates}
            <p class="mcp-cache-note">
              ttl {resourceTemplates.ttlMs ?? 0}ms · {resourceTemplates.cacheScope ?? "private"}
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
    </section>

    {#if source && !overLimit}
      <section aria-labelledby="mcp-call-heading">
        <h2 id="mcp-call-heading">Call a tool</h2>
        <label class="mcp-tool-picker">
          <span>Tool</span>
          <select bind:value={selectedToolName}>
            {#each tools?.items ?? [] as t (t.name)}
              <option value={t.name}>{t.title ?? t.name}</option>
            {/each}
          </select>
        </label>
        {#if selectedTool}
          {#key selectedTool.name}
            <ArgsForm
              tool={selectedTool}
              omit={selectedTool.name === TOOL_NAMES.analyzeDocument ? ["demo", "documents"] : []}
              initial={selectedTool.name === TOOL_NAMES.analyzeDocument
                ? { config: configSeed, minSeverity: "info" }
                : {}}
              onsubmit={callTool}
            />
          {/key}
        {/if}
        {#if calling}<p role="status">Calling {selectedTool?.name}…</p>{/if}
        {#if callError}<p class="mcp-error" role="alert">{callError}</p>{/if}
      </section>
    {/if}

    <section aria-labelledby="mcp-wire-heading">
      <h2 id="mcp-wire-heading">Wire log</h2>
      <WireLog exchanges={wireLog} />
    </section>

    {#if result}
      <section aria-labelledby="mcp-result-heading">
        <h2 id="mcp-result-heading">Result</h2>
        {#if result.isError}
          <p class="mcp-result-error" role="alert">
            The tool returned an error — see the text below.
          </p>
        {/if}
        {#each result.content as block, i (i)}
          {#if block.type === "text"}
            <pre class="mcp-result-text">{block.text}</pre>
          {:else if block.type === "resource_link"}
            <button type="button" class="mcp-resource-link" onclick={() => readLink(block.uri)}>
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
      </section>
    {/if}
  {/if}
</section>
