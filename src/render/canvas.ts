// The shared zoom/pan SVG canvas. Hosts one DocumentView per document, stacks them
// vertically (entry document first, at the top-left), and provides fit/zoom plus
// expand-all / collapse-all across the whole OAD. A single coordinate space is used
// so that future cross-document reference edges can be drawn directly between groups.

import { select, zoom, zoomIdentity } from "d3";
import type { Selection, ZoomBehavior } from "d3";
import type { Oad, OadDocument, TreeNode } from "../types";
import { DocumentView } from "./treeView";

const DOC_GAP = 56;

export interface CanvasCallbacks {
  onSelect: (doc: OadDocument, node: TreeNode) => void;
  onBackground: () => void;
}

export class Canvas {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly viewport: Selection<SVGGElement, unknown, null, undefined>;
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private readonly cb: CanvasCallbacks;
  private views: DocumentView[] = [];

  constructor(container: HTMLElement, cb: CanvasCallbacks) {
    this.cb = cb;
    container.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "canvas-toolbar";
    toolbar.innerHTML = `
      <button type="button" data-act="fit">Fit</button>
      <button type="button" data-act="expand">Expand all</button>
      <button type="button" data-act="collapse">Collapse all</button>
    `;
    toolbar.addEventListener("click", (e) => this.onToolbar(e));
    container.appendChild(toolbar);

    this.svg = select(container)
      .append("svg")
      .attr("class", "tree-canvas")
      .attr("width", "100%")
      .attr("height", "100%");
    this.viewport = this.svg.append("g").attr("class", "viewport");

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 3])
      .on("zoom", (event) => this.viewport.attr("transform", event.transform.toString()));
    this.svg.call(this.zoomBehavior);

    this.svg.on("click", () => {
      this.views.forEach((v) => v.clearSelection());
      this.cb.onBackground();
    });

    window.addEventListener("resize", () => this.fit());
  }

  render(oad: Oad): void {
    this.viewport.selectAll("*").remove();
    this.views = [];

    const vpNode = this.viewport.node();
    if (!vpNode) return;

    for (const doc of oad.documents) {
      // `view` is captured by the callbacks, which only fire after construction.
      const view: DocumentView = new DocumentView(vpNode, doc, {
        onSelect: (d, n) => {
          this.views.forEach((other) => {
            if (other !== view) other.clearSelection();
          });
          this.cb.onSelect(d, n);
        },
        onLayoutChanged: () => this.retile(),
      });
      this.views.push(view);
    }

    this.retile();
    this.fit();
  }

  /** Lay document groups out left to right, entry first, sized to current extents. */
  private retile(): void {
    let x = 0;
    for (const view of this.views) {
      view.setOffset(x);
      x += view.width + DOC_GAP;
    }
  }

  /** Fit all content into view (entry document leftmost). */
  fit(): void {
    const node = this.viewport.node();
    const svgNode = this.svg.node();
    if (!node || !svgNode) return;

    let bbox: DOMRect;
    try {
      bbox = node.getBBox();
    } catch {
      return;
    }
    if (bbox.width === 0 || bbox.height === 0) return;

    const sw = svgNode.clientWidth || 900;
    const sh = svgNode.clientHeight || 600;
    const margin = 48;
    const k = Math.min((sw - margin) / bbox.width, (sh - margin) / bbox.height, 1.2);
    const scaledW = bbox.width * k;
    const scaledH = bbox.height * k;
    // Center when the content fits; otherwise pin to a small margin (top-left).
    const tx = (scaledW < sw ? (sw - scaledW) / 2 : 24) - bbox.x * k;
    const ty = (scaledH < sh ? (sh - scaledH) / 2 : 24) - bbox.y * k;

    this.svg
      .transition()
      .duration(300)
      .call(this.zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  private onToolbar(e: MouseEvent): void {
    const act = (e.target as HTMLElement).getAttribute("data-act");
    if (act === "fit") {
      this.fit();
    } else if (act === "expand") {
      this.views.forEach((v) => v.expandAll());
      this.fit();
    } else if (act === "collapse") {
      this.views.forEach((v) => v.collapseAll());
      this.fit();
    }
  }
}
