<script lang="ts">
  import type { Oad, OadDocument, TreeNode } from "../types";
  import type { ResolvedRefs } from "../refs/types";
  import type { DocInput } from "../loader";
  import type { ViewRequest } from "../app/viewUrl";
  import TreeCanvas from "../render/TreeCanvas.svelte";
  import DetailPanel from "../render/DetailPanel.svelte";
  import Legend from "../render/Legend.svelte";
  import IssueReport from "../render/IssueReport.svelte";
  import type { DetailContext } from "../render/detail";
  import { unreachableDocs } from "../render/reachability";
  import { collectIssues, type IssueReport as IssueReportData } from "../render/issues";
  import { runPipeline, docLabel } from "../app/bootstrap";
  import { demoInputs } from "../app/demos";
  import { session } from "../app/session.svelte";
  import { navigate } from "../app/router.svelte";

  // The Explore page: resolve the requested documents (a demo, online URLs, or an
  // in-memory upload handoff), run the load → resolve pipeline, and render the tree,
  // legend, detail panel and issue drawer. App owns the route; this page owns the OAD state.
  let { request }: { request: ViewRequest } = $props();

  let treeCanvas: { navigateTo: (docId: string, nodeId: string) => void } | undefined = $state();

  let oad = $state<Oad | null>(null);
  let refs = $state<ResolvedRefs | null>(null);
  let selected = $state<{ doc: OadDocument; node: TreeNode } | null>(null);

  type Status = "loading" | "ready" | "empty" | "error";
  let status = $state<Status>("loading");
  let loadError = $state<string | null>(null);

  const unreachable = $derived(oad && refs ? unreachableDocs(oad, refs) : []);
  const unreachableDocIds = $derived(new Set(unreachable.map((d) => d.id)));
  const issueReport = $derived<IssueReportData | null>(
    oad && refs ? collectIssues(oad, refs, unreachable) : null,
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

  function show(oadResult: Oad, refsResult: ResolvedRefs): void {
    selected = null;
    oad = oadResult;
    refs = refsResult;
    status = "ready";
  }

  function fail(message: string): void {
    oad = null;
    refs = null;
    selected = null;
    loadError = message;
    status = "error";
  }

  async function loadInputs(inputs: DocInput[]): Promise<void> {
    const token = ++loadToken;
    status = "loading";
    const result = await runPipeline(inputs);
    if (token !== loadToken) return; // a newer request superseded this one
    if (!result.ok) {
      const parts = [
        ...Object.values(result.rowErrors ?? {}),
        ...(result.oadError ? [result.oadError] : []),
      ];
      fail(parts.join(" ") || "Could not load the requested documents.");
      return;
    }
    show(result.oad, result.refs);
  }

  function resolve(req: ViewRequest): void {
    loadError = null;
    if (req.kind === "session") {
      const handed = session.result;
      if (handed) void show(handed.oad, handed.refs);
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
      {unreachableDocIds}
      onselect={(doc, node) => (selected = { doc, node })}
      onbackground={() => (selected = null)}
      onLoadAnother={() => navigate("/configure")}
      bind:this={treeCanvas}
    />
    <aside id="detail-panel" aria-label="Selected node details">
      <Legend />
      <DetailPanel {selected} ctx={detailCtx} />
    </aside>
  {:else if status === "loading"}
    <p class="view-status" role="status">Loading documents…</p>
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
      <button type="button" class="view-back" onclick={() => navigate("/configure")}>
        Back to configure
      </button>
    </div>
  {/if}
</section>

<IssueReport report={issueReport} />
