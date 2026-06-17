<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { Oad, OadDocument, TreeNode } from "./types";
  import type { ResolvedRefs } from "./refs/types";
  import type { DocInput } from "./loader";
  import { OadForm } from "./ui/oadForm";
  import type { RenderOutcome } from "./ui/oadForm";
  import { setupTheme } from "./ui/theme";
  import TreeCanvas from "./render/TreeCanvas.svelte";
  import { renderLegend, renderDetail, clearDetail } from "./render/detailPanel";
  import type { DetailContext } from "./render/detailPanel";
  import { runPipeline, docLabel } from "./app/bootstrap";

  // Imperative leaves (form, theme, detail panel) still own their DOM this pass; App
  // owns the reactive app state and drives them.
  let header: HTMLElement;
  let inputPanel: HTMLElement;
  let viewerEl: HTMLElement;
  let detailEl: HTMLElement;
  let treeCanvas: { navigateTo: (docId: string, nodeId: string) => void } | undefined = $state();

  let oad = $state<Oad | null>(null);
  let refs = $state<ResolvedRefs | null>(null);
  let selected = $state<{ doc: OadDocument; node: TreeNode } | null>(null);

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

  onMount(() => {
    setupTheme(header);
    new OadForm(inputPanel, { onRender });
  });

  // A fresh OAD resets the panel to the legend + empty hint.
  $effect(() => {
    if (oad && detailEl) renderLegend(detailEl);
  });

  // Selection drives the detail subsection (legend stays put above it).
  $effect(() => {
    if (!detailEl || !oad) return;
    if (selected && detailCtx) renderDetail(detailEl, selected.doc, selected.node, detailCtx);
    else clearDetail(detailEl);
  });
</script>

<header id="app-header" bind:this={header}>
  <h1>OAS Structure Viewer</h1>
  <p class="tagline">
    Parent/child structure of an OpenAPI Description, document by document.
  </p>
</header>

<main id="app">
  <!-- The input form is rendered into here by ui/oadForm.ts -->
  <section id="input-panel" bind:this={inputPanel} aria-label="OAD input"></section>

  <section id="viewer" bind:this={viewerEl} hidden={!oad}>
    {#if oad}
      <TreeCanvas
        {oad}
        {refs}
        onselect={(doc, node) => (selected = { doc, node })}
        onbackground={() => (selected = null)}
        bind:this={treeCanvas}
      />
    {/if}
    <aside id="detail-panel" bind:this={detailEl} aria-label="Selected node details"></aside>
  </section>
</main>
