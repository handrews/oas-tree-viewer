// The shared zoom/pan SVG canvas. Hosts one DocumentView per document (tiled left to
// right, entry first) and an overlay layer that draws reference edges as on-demand curved
// arcs across the single shared coordinate space.

import { select, zoom, zoomIdentity, zoomTransform } from "d3";
import type { Selection, ZoomBehavior } from "d3";
import type { Oad, OadDocument, TreeNode } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "../refs/types";
import { refKey } from "../refs/types";
import { DocumentView } from "./treeView";

const DOC_GAP = 56;

export interface CanvasCallbacks {
  onSelect: (doc: OadDocument, node: TreeNode) => void;
  onBackground: () => void;
}

interface Anchor {
  x: number;
  y: number;
  collapsed: boolean;
}
interface EdgeGeo {
  edge: ReferenceEdge;
  s: Anchor;
  t: Anchor;
  focused: boolean;
}

export class Canvas {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly viewport: Selection<SVGGElement, unknown, null, undefined>;
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private readonly cb: CanvasCallbacks;
  private readonly showAllBtn: HTMLButtonElement;
  private views: DocumentView[] = [];

  private arcs: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private warnG: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private resolved: ResolvedRefs | null = null;
  private focusKey: string | null = null;
  private showAll = false;

  constructor(container: HTMLElement, cb: CanvasCallbacks) {
    this.cb = cb;
    container.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "canvas-toolbar";
    toolbar.innerHTML = `
      <button type="button" data-act="fit">Fit</button>
      <button type="button" data-act="expand">Expand all</button>
      <button type="button" data-act="collapse">Collapse all</button>
      <button type="button" data-act="showall">Show all references</button>
    `;
    toolbar.addEventListener("click", (e) => this.onToolbar(e));
    container.appendChild(toolbar);
    this.showAllBtn = toolbar.querySelector<HTMLButtonElement>('[data-act="showall"]')!;
    this.showAllBtn.setAttribute("aria-pressed", "false");

    this.svg = select(container)
      .append("svg")
      .attr("class", "tree-canvas")
      .attr("role", "img")
      .attr(
        "aria-label",
        "Document structure trees — an interactive visual; use the toolbar above and the detail panel to inspect nodes",
      )
      .attr("width", "100%")
      .attr("height", "100%");

    const defs = this.svg.append("defs");
    defs
      .append("marker")
      .attr("id", "ref-arrow")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("class", "ref-arrowhead")
      .attr("d", "M0,0 L10,5 L0,10 z");

    this.viewport = this.svg.append("g").attr("class", "viewport");

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 3])
      .on("zoom", (event) => this.viewport.attr("transform", event.transform.toString()));
    this.svg.call(this.zoomBehavior);

    this.svg.on("click", () => {
      this.views.forEach((v) => v.clearSelection());
      this.focusKey = null;
      this.refreshEdges();
      this.cb.onBackground();
    });

    window.addEventListener("resize", () => this.fit());
  }

  render(oad: Oad): void {
    this.viewport.selectAll("*").remove();
    this.views = [];
    this.focusKey = null;

    const vpNode = this.viewport.node();
    if (!vpNode) return;

    for (const doc of oad.documents) {
      const view: DocumentView = new DocumentView(vpNode, doc, {
        onSelect: (d, n) => this.onSelectInternal(d, n),
        onLayoutChanged: () => {
          this.retile();
          this.refreshEdges();
          this.drawWarnings();
        },
      });
      this.views.push(view);
    }

    // Edge overlay sits above the document groups.
    const edgeLayer = this.viewport.append("g").attr("class", "edges");
    this.warnG = edgeLayer.append("g").attr("class", "warnings");
    this.arcs = edgeLayer.append("g").attr("class", "arcs");

    this.retile();
    this.fit();
  }

  /** Provide resolved references; draws warning glyphs and any active edges. */
  setReferences(resolved: ResolvedRefs): void {
    this.resolved = resolved;
    this.focusKey = null;
    this.drawWarnings();
    this.refreshEdges();
  }

  /** Reveal, select, and recenter on a node (used by edge clicks and the detail panel). */
  navigateTo(docId: string, nodeId: string): void {
    const view = this.viewForDoc(docId);
    if (!view) return;
    view.revealPath(nodeId);
    view.selectById(nodeId);
    const anchor = view.anchorViewport(nodeId);
    if (anchor) this.recenter(anchor.x, anchor.y);
  }

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
    const tx = (scaledW < sw ? (sw - scaledW) / 2 : 24) - bbox.x * k;
    const ty = (scaledH < sh ? (sh - scaledH) / 2 : 24) - bbox.y * k;

    this.svg
      .transition()
      .duration(300)
      .call(this.zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private onSelectInternal(doc: OadDocument, node: TreeNode): void {
    this.views.forEach((v) => {
      if (v.doc.id !== doc.id) v.clearSelection();
    });
    this.focusKey = refKey(doc.id, node.id);
    this.refreshEdges();
    this.cb.onSelect(doc, node);
  }

  private retile(): void {
    let x = 0;
    for (const view of this.views) {
      view.setOffset(x);
      x += view.width + DOC_GAP;
    }
  }

  private viewForDoc(docId: string): DocumentView | undefined {
    return this.views.find((v) => v.doc.id === docId);
  }

  /** Edges in focus = those touching the selected node (as source or target). */
  private focusEdges(): ReferenceEdge[] {
    if (!this.focusKey || !this.resolved) return [];
    const seen = new Map<string, ReferenceEdge>();
    for (const e of this.resolved.bySource.get(this.focusKey) ?? []) seen.set(e.id, e);
    for (const e of this.resolved.byTarget.get(this.focusKey) ?? []) seen.set(e.id, e);
    return [...seen.values()];
  }

  private refreshEdges(): void {
    if (!this.arcs) return;
    if (!this.resolved) {
      this.arcs.selectAll("path").remove();
      return;
    }
    const focus = this.focusEdges();
    const focusIds = new Set(focus.map((e) => e.id));
    const set = this.showAll ? this.resolved.edges : focus;
    const geos = this.edgeGeometries(set, focusIds);

    this.arcs
      .selectAll<SVGPathElement, EdgeGeo>("path")
      .data(geos, (d) => d.edge.id)
      .join("path")
      .attr(
        "class",
        (d) =>
          `ref-edge status-${d.edge.status}` +
          (d.s.collapsed || d.t.collapsed ? " collapsed" : "") +
          (d.focused ? " focused" : ""),
      )
      .attr("d", (d) => arcPath(d.s, d.t))
      .attr("marker-end", "url(#ref-arrow)")
      .on("click", (event: MouseEvent, d) => {
        event.stopPropagation();
        if (d.edge.targetDocId && d.edge.targetNodeId) {
          this.navigateTo(d.edge.targetDocId, d.edge.targetNodeId);
        }
      });
  }

  private edgeGeometries(edges: ReferenceEdge[], focusIds: Set<string>): EdgeGeo[] {
    const out: EdgeGeo[] = [];
    for (const edge of edges) {
      if (!edge.targetDocId || !edge.targetNodeId) continue; // external/broken: no arc
      const sv = this.viewForDoc(edge.sourceDocId);
      const tv = this.viewForDoc(edge.targetDocId);
      if (!sv || !tv) continue;
      const s = sv.anchorViewport(edge.sourceNodeId);
      const t = tv.anchorViewport(edge.targetNodeId);
      if (!s || !t) continue;
      out.push({ edge, s, t, focused: focusIds.has(edge.id) });
    }
    return out;
  }

  private drawWarnings(): void {
    if (!this.warnG) return;
    if (!this.resolved) {
      this.warnG.selectAll("text").remove();
      return;
    }
    // Group unresolved refs by the row they land on (several can collapse onto the
    // same ancestor row). Each group renders one glyph; `broken` outranks `external`.
    const groups = new Map<string, { x: number; y: number; broken: boolean; count: number }>();
    for (const edge of this.resolved.edges) {
      if (edge.status !== "external" && edge.status !== "broken") continue;
      const sv = this.viewForDoc(edge.sourceDocId);
      if (!sv) continue;
      // Anchor in the right gutter, past the label, clear of the dot/triangle.
      const p = sv.labelEndViewport(edge.sourceNodeId);
      if (!p) continue;
      const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
      const g = groups.get(key);
      if (g) {
        g.count += 1;
        if (edge.status === "broken") g.broken = true;
      } else {
        groups.set(key, { x: p.x, y: p.y, broken: edge.status === "broken", count: 1 });
      }
    }
    const data = [...groups].map(([key, g]) => ({ key, ...g }));

    this.warnG
      .selectAll<SVGTextElement, (typeof data)[number]>("text")
      .data(data, (d) => d.key)
      .join("text")
      .attr("class", (d) => `warn-glyph status-${d.broken ? "broken" : "external"}`)
      .attr("x", (d) => d.x + 12)
      .attr("y", (d) => d.y + 6)
      .attr("text-anchor", "start")
      .each(function (this: SVGTextElement, d) {
        const sel = select(this);
        sel.selectAll("*").remove();
        sel.text(null);
        sel.append("title").text(
          d.count > 1
            ? `${d.count} unresolved references on this row`
            : d.broken
              ? "Unresolved reference (target not found)"
              : "Unresolved reference (external document not loaded)",
        );
        sel.append("tspan").text("⚠");
        if (d.count > 1) {
          sel.append("tspan").attr("class", "warn-count").attr("dx", "1").text(String(d.count));
        }
      });
  }

  private recenter(x: number, y: number): void {
    const svgNode = this.svg.node();
    if (!svgNode) return;
    const k = zoomTransform(svgNode).k;
    const sw = svgNode.clientWidth || 900;
    const sh = svgNode.clientHeight || 600;
    this.svg
      .transition()
      .duration(400)
      .call(this.zoomBehavior.transform, zoomIdentity.translate(sw / 2 - k * x, sh / 2 - k * y).scale(k));
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
    } else if (act === "showall") {
      this.showAll = !this.showAll;
      this.showAllBtn.classList.toggle("active", this.showAll);
      this.showAllBtn.setAttribute("aria-pressed", String(this.showAll));
      this.refreshEdges();
    }
  }
}

/** Curved cubic-bezier arc between two viewport-space anchors. */
function arcPath(s: Anchor, t: Anchor): string {
  const dx = t.x - s.x;
  let c1x: number;
  let c2x: number;
  if (Math.abs(dx) < 12) {
    // Near-vertical (same column): bow out to one side like an arc diagram.
    const bow = 40 + Math.abs(t.y - s.y) * 0.15;
    c1x = s.x + bow;
    c2x = t.x + bow;
  } else {
    const dir = dx >= 0 ? 1 : -1;
    const c = Math.max(40, Math.abs(dx) * 0.4);
    c1x = s.x + dir * c;
    c2x = t.x - dir * c;
  }
  return `M${s.x},${s.y} C${c1x},${s.y} ${c2x},${t.y} ${t.x},${t.y}`;
}
