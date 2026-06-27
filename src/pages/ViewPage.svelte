<script lang="ts">
  import type { Oad, OadDocument, TreeNode } from "../types";
  import type { ResolvedRefs } from "../refs/types";
  import type { Diagnostic } from "../diagnostics/types";
  import type { DocInput } from "../loader";
  import type { ViewRequest } from "../app/viewUrl";
  import type { ViewerConfig } from "../app/config";
  import TreeCanvas from "../render/TreeCanvas.svelte";
  import DetailPanel from "../render/DetailPanel.svelte";
  import Legend from "../render/Legend.svelte";
  import IssueReport from "../render/IssueReport.svelte";
  import type { DetailContext } from "../render/detail";
  import { unreachableDocs } from "../render/reachability";
  import { collectIssues, type IssueReport as IssueReportData } from "../render/issues";
  import { docLabel, type PipelineOptions } from "../app/bootstrap";
  import { pipelineClient, PipelineCancelled } from "../app/pipelineClient";
  import { errorMessage } from "../errors";
  import { demoInputs } from "../app/demos";
  import { session } from "../app/session.svelte";
  import { navigate } from "../app/router.svelte";

  // The Explore page: resolve the requested documents (a demo, online URLs, or an
  // in-memory upload handoff), run the load → resolve pipeline, and render the tree,
  // legend, detail panel and issue drawer. App owns the route; this page owns the OAD state.
  let { request, config }: { request: ViewRequest; config: ViewerConfig } = $props();

  let treeCanvas: { navigateTo: (docId: string, nodeId: string) => void } | undefined = $state();

  let oad = $state<Oad | null>(null);
  let refs = $state<ResolvedRefs | null>(null);
  // Unified non-blocking findings, computed in the worker (runPipeline) and carried in the result.
  let diagnostics = $state<Diagnostic[]>([]);
  let selected = $state<{ doc: OadDocument; node: TreeNode } | null>(null);

  type Status = "loading" | "ready" | "empty" | "error";
  let status = $state<Status>("loading");
  let loadError = $state<string | null>(null);
  // A resource-guard refusal offers a "Load anyway" retry; remember the inputs to re-run.
  let limited = $state(false);
  let lastInputs = $state<DocInput[]>([]);

  const unreachable = $derived(oad && refs ? unreachableDocs(oad, refs) : []);
  const unreachableDocIds = $derived(new Set(unreachable.map((d) => d.id)));
  const issueReport = $derived<IssueReportData | null>(
    oad ? collectIssues(oad, diagnostics) : null,
  );

  const detailCtx = $derived<DetailContext | null>(
    oad && refs
      ? {
          refs,
          docLabel: (id: string) =>
            docLabel(new Map(oad!.documents.map((d) => [d.id, d])).get(id), id),
          onNavigate: (docId: string, nodeId: string) => treeCanvas?.navigateTo(docId, nodeId),
        }
      : null,
  );

  // Guard against an out-of-order async load when the request changes mid-flight.
  let loadToken = 0;

  function show(oadResult: Oad, refsResult: ResolvedRefs, diagnosticsResult: Diagnostic[]): void {
    selected = null;
    oad = oadResult;
    refs = refsResult;
    diagnostics = diagnosticsResult;
    status = "ready";
  }

  function fail(message: string): void {
    oad = null;
    refs = null;
    diagnostics = [];
    selected = null;
    loadError = message;
    status = "error";
  }

  async function loadInputs(inputs: DocInput[], opts: PipelineOptions = {}): Promise<void> {
    const token = ++loadToken;
    lastInputs = inputs;
    limited = false;
    status = "loading";
    // Run off-thread so the page stays responsive and the load can be cancelled. `inputs` (when reused
    // from `lastInputs`) and `config` are reactive ($state proxies), so snapshot them to plain objects —
    // a proxy can't be structured-cloned across the worker boundary.
    let result;
    try {
      result = await pipelineClient.run($state.snapshot(inputs), $state.snapshot(config), opts);
    } catch (e) {
      if (token !== loadToken) return; // superseded or cancelled — newer state already applied
      if (e instanceof PipelineCancelled) return; // cancelLoad set the next state
      fail(errorMessage(e));
      return;
    }
    if (token !== loadToken) return; // a newer request superseded this one
    if (!result.ok) {
      limited = result.limited ?? false;
      const parts = [
        ...Object.values(result.rowErrors ?? {}),
        ...(result.oadError ? [result.oadError] : []),
      ];
      fail(parts.join(" ") || "Could not load the requested documents.");
      return;
    }
    show(result.oad, result.refs, result.diagnostics);
  }

  // "Load anyway": re-run the same documents with the resource limits lifted.
  function loadAnyway(): void {
    void loadInputs(lastInputs, { enforceLimits: false });
  }

  // Cancel an in-flight load: terminate the worker and leave the explorer for the Configure page.
  function cancelLoad(): void {
    loadToken++; // invalidate the in-flight load so a late result is ignored
    pipelineClient.cancel();
    navigate("/configure");
  }

  function resolve(req: ViewRequest): void {
    loadError = null;
    if (req.kind === "session") {
      const handed = session.result;
      if (handed) void show(handed.oad, handed.refs, handed.diagnostics);
      else {
        oad = null;
        refs = null;
        status = "empty";
      }
      return;
    }
    if (req.kind === "urls") {
      void loadInputs(req.docs.map((d) => ({ source: "url", url: d.url, isEntry: d.isEntry })));
      return;
    }
    const inputs = demoInputs(req.demoId);
    if (!inputs) {
      fail(`Unknown demo: ${req.demoId}`);
      return;
    }
    void loadInputs(inputs);
  }

  $effect(() => {
    resolve(request);
  });
</script>

<section id="viewer">
  {#if status === "ready" && oad}
    <TreeCanvas
      {oad}
      {refs}
      {diagnostics}
      {unreachableDocIds}
      onselect={(doc, node) => (selected = { doc, node })}
      onbackground={() => (selected = null)}
      onLoadAnother={() => navigate("/configure")}
      onRenderError={(msg) => fail(msg)}
      bind:this={treeCanvas}
    />
    <aside id="detail-panel" aria-label="Node details">
      <Legend />
      <DetailPanel {selected} ctx={detailCtx} />
    </aside>
  {:else if status === "loading"}
    <div class="view-loading">
      <p class="view-status" role="status">Loading documents…</p>
      <button type="button" class="view-cancel" onclick={cancelLoad}>Cancel</button>
    </div>
  {:else if status === "empty"}
    <div class="view-empty">
      <p>This view was built from uploaded files, so there's nothing to reload.</p>
      <button type="button" class="view-back" onclick={() => navigate("/configure")}>
        Start over
      </button>
    </div>
  {:else if status === "error"}
    <div class="view-error" role="alert">
      <p class="view-error-msg">{loadError}</p>
      {#if limited}
        <p class="view-error-note">Loading it anyway may make the page slow or unresponsive.</p>
        <button type="button" class="load-anyway" onclick={loadAnyway}>Load anyway</button>
      {/if}
      <button type="button" class="view-back" onclick={() => navigate("/configure")}>
        Back to configure
      </button>
    </div>
  {/if}
</section>

<IssueReport
  report={issueReport}
  onJump={(docId, nodeId) => treeCanvas?.navigateTo(docId, nodeId)}
/>
