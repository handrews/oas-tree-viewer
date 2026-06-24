<script lang="ts">
  // Imperative-island wrapper for the d3/SVG Canvas. Svelte owns the container and the
  // reactive props; the Canvas class owns all SVG rendering, zoom/pan and edge drawing.
  import type { Oad, OadDocument, TreeNode } from "../types";
  import type { ResolvedRefs } from "../refs/types";
  import { Canvas } from "./canvas";

  let {
    oad,
    refs,
    unreachableDocIds = new Set<string>(),
    onselect,
    onbackground,
    onLoadAnother,
  }: {
    oad: Oad;
    refs: ResolvedRefs | null;
    unreachableDocIds?: ReadonlySet<string>;
    onselect: (doc: OadDocument, node: TreeNode) => void;
    onbackground: () => void;
    onLoadAnother?: () => void;
  } = $props();

  let wrap: HTMLDivElement;
  let canvas: Canvas | undefined;

  // Create the Canvas once (the bound div exists before effects run), then re-render
  // whenever the OAD or resolved references change.
  $effect(() => {
    if (!canvas)
      canvas = new Canvas(wrap, { onSelect: onselect, onBackground: onbackground, onLoadAnother });
    canvas.render(oad, unreachableDocIds);
    if (refs) canvas.setReferences(refs);
  });

  /** Reveal, select, and recenter on a node — used by the detail panel's nav links. */
  export function navigateTo(docId: string, nodeId: string): void {
    canvas?.navigateTo(docId, nodeId);
  }
</script>

<!-- Keyboard help for the trees inside the canvas, referenced by each tree's aria-describedby. It sits
     outside #canvas-wrap because the Canvas class clears that container's contents on render. -->
<p id="tree-help" class="sr-only">
  Use the up and down arrow keys to move between nodes; right and left arrows expand and collapse a node;
  Enter or Space selects the focused node.
</p>
<div bind:this={wrap} id="canvas-wrap" aria-label="Document trees"></div>
