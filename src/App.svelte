<script lang="ts">
  import { tick } from "svelte";
  import type { Oad, OadDocument, TreeNode } from "./types";
  import type { ResolvedRefs } from "./refs/types";
  import type { DocInput } from "./loader";
  import OadForm from "./ui/OadForm.svelte";
  import type { RenderOutcome } from "./ui/oadForm";
  import ThemeToggle from "./ui/ThemeToggle.svelte";
  import TreeCanvas from "./render/TreeCanvas.svelte";
  import DetailPanel from "./render/DetailPanel.svelte";
  import Legend from "./render/Legend.svelte";
  import IssueReport from "./render/IssueReport.svelte";
  import type { DetailContext } from "./render/detail";
  import { unreachableDocs } from "./render/reachability";
  import { collectIssues, type IssueReport as IssueReportData } from "./render/issues";
  import { runPipeline, docLabel } from "./app/bootstrap";

  // App owns the reactive app state and renders the form, canvas, and detail panel as
  // components.
  let viewerEl: HTMLElement;
  let treeCanvas: { navigateTo: (docId: string, nodeId: string) => void } | undefined = $state();

  let oad = $state<Oad | null>(null);
  let refs = $state<ResolvedRefs | null>(null);
  let selected = $state<{ doc: OadDocument; node: TreeNode } | null>(null);

  // Documents not reachable from the entry (a non-fatal warning), and the aggregated,
  // copy-pasteable issue report — both derived from the resolved OAD.
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

  async function onRender(inputs: DocInput[]): Promise<RenderOutcome> {
    const result = await runPipeline(inputs);
    if (!result.ok) return { ok: false, rowErrors: result.rowErrors, oadError: result.oadError };
    selected = null;
    oad = result.oad;
    refs = result.refs;
    await tick();
    viewerEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    return { ok: true };
  }
</script>

<header id="app-header">
  <h1>OAS Structure Viewer</h1>
  <p class="tagline">
    Parent/child structure of an OpenAPI Description, document by document.
  </p>
  <ThemeToggle />
</header>

<main id="app">
  <section id="input-panel" aria-label="OAD input">
    <OadForm {onRender} />
  </section>

  <section id="viewer" bind:this={viewerEl} hidden={!oad}>
    {#if oad}
      <TreeCanvas
        {oad}
        {refs}
        {unreachableDocIds}
        onselect={(doc, node) => (selected = { doc, node })}
        onbackground={() => (selected = null)}
        bind:this={treeCanvas}
      />
    {/if}
    <aside id="detail-panel" aria-label="Selected node details">
      <Legend />
      <DetailPanel {selected} ctx={detailCtx} />
    </aside>
  </section>

  <IssueReport report={issueReport} />
</main>
