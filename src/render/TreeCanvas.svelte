<script lang="ts">
  // Imperative-island wrapper for the d3/SVG Canvas. Svelte owns the container and the
  // reactive props; the Canvas class owns all SVG rendering, zoom/pan and edge drawing.
  import type { Oad, OadDocument, TreeNode } from "../types";
  import type { ResolvedRefs } from "../refs/types";
  import { errorMessage } from "../errors";
  import { Canvas } from "./canvas";

  let {
    oad,
    refs,
    unreachableDocIds = new Set<string>(),
    onselect,
    onbackground,
    onLoadAnother,
    onRenderError,
  }: {
    oad: Oad;
    refs: ResolvedRefs | null;
    unreachableDocIds?: ReadonlySet<string>;
    onselect: (doc: OadDocument, node: TreeNode) => void;
    onbackground: () => void;
    onLoadAnother?: () => void;
    /** Called if rendering throws — e.g. a stack overflow building the d3 hierarchy of a huge
     *  document loaded via the "Load anyway" override. Lets the page show an error instead of crashing. */
    onRenderError?: (message: string) => void;
  } = $props();

  let wrap: HTMLDivElement;
  let canvas: Canvas | undefined;

  // Create the Canvas once (the bound div exists before effects run), then re-render
  // whenever the OAD or resolved references change. Rendering only throws for a pathologically
  // large/deep document admitted past the limits ("Load anyway"); surface that rather than crash.
  $effect(() => {
    try {
      if (!canvas)
        canvas = new Canvas(wrap, { onSelect: onselect, onBackground: onbackground, onLoadAnother });
      canvas.render(oad, unreachableDocIds);
      if (refs) canvas.setReferences(refs);
    } catch (e) {
      onRenderError?.(errorMessage(e));
    }
  });

  /** Reveal, select, and recenter on a node — used by the detail panel's nav links. */
  export function navigateTo(docId: string, nodeId: string): void {
    canvas?.navigateTo(docId, nodeId);
  }
</script>

<div bind:this={wrap} id="canvas-wrap" aria-label="Document trees"></div>
