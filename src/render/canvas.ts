// The shared zoom/pan SVG canvas. Hosts one DocumentView per document (tiled left to
// right, entry first) and an overlay layer that draws reference edges as on-demand curved
// arcs across the single shared coordinate space.

import { select, zoom, zoomIdentity, zoomTransform } from "d3";
import type { Selection, ZoomBehavior } from "d3";
import type { Oad, OadDocument, TreeNode } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "../refs/types";
import { refKey } from "../refs/types";
import { resolutionStyles } from "./colors";
import { DocumentView } from "./treeView";

const DOC_GAP = 56;
// Reference arcs leave the source past its label (where ⚠ markers sit) and enter the
// target from the left, with the arrowhead sitting clear to the left of the target's
// disclosure triangle (which starts ~16px left of the node marker) rather than on top.
const EDGE_SOURCE_GAP = 10;
const EDGE_TARGET_GAP = 20;

export interface CanvasCallbacks {
  onSelect: (doc: OadDocument, node: TreeNode) => void;
  onBackground: () => void;
  /** Optional: when provided, a right-aligned toolbar button invokes it (leave the explorer). */
  onLoadAnother?: () => void;
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
  private arcsDouble: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private warnG: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private advisoryG: Selection<SVGGElement, unknown, null, undefined> | null = null;
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

    // App-level navigation lives at the end of the toolbar row when wired (it leaves the
    // explorer rather than acting on the canvas), kept visually apart via margin-left:auto.
    if (cb.onLoadAnother) {
      const another = document.createElement("button");
      another.type = "button";
      another.className = "load-another";
      another.dataset.act = "another";
      another.textContent = "Load a different OAD";
      toolbar.appendChild(another);
    }

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

    // Open (stick) arrowhead for component-name references — not filled, so it reads distinct.
    defs
      .append("marker")
      .attr("id", "ref-arrow-open")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 11)
      .attr("markerHeight", 11)
      .attr("markerUnits", "userSpaceOnUse")
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("class", "ref-arrowhead-open")
      .attr("d", "M1,1 L9,5 L1,9");

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

  render(oad: Oad, unreachableDocIds: ReadonlySet<string> = new Set()): void {
    this.viewport.selectAll("*").remove();
    this.views = [];
    this.focusKey = null;

    const vpNode = this.viewport.node();
    if (!vpNode) return;

    for (const doc of oad.documents) {
      const view: DocumentView = new DocumentView(
        vpNode,
        doc,
        {
          onSelect: (d, n) => this.onSelectInternal(d, n),
          onLayoutChanged: () => {
            this.retile();
            this.refreshEdges();
            this.drawWarnings();
            this.drawAdvisories();
          },
        },
        unreachableDocIds.has(doc.id),
      );
      this.views.push(view);
    }

    // Edge overlay sits above the document groups.
    const edgeLayer = this.viewport.append("g").attr("class", "edges");
    this.warnG = edgeLayer.append("g").attr("class", "warnings");
    // Advisory glyphs (resolved-but-problematic references) sit beside the unresolved ⚠ glyphs.
    this.advisoryG = edgeLayer.append("g").attr("class", "advisories");
    this.arcs = edgeLayer.append("g").attr("class", "arcs");
    // Component-name arcs render as two offset lines (a transparent gap between) so they read
    // as a double line yet stay legible where they cross labels.
    this.arcsDouble = edgeLayer.append("g").attr("class", "arcs-double");

    this.retile();
    this.fit();
  }

  /** Provide resolved references; draws warning glyphs and any active edges. */
  setReferences(resolved: ResolvedRefs): void {
    this.resolved = resolved;
    this.focusKey = null;
    this.drawWarnings();
    this.drawAdvisories();
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
    if (!this.arcs || !this.arcsDouble) return;
    if (!this.resolved) {
      this.arcs.selectAll("path").remove();
      this.arcsDouble.selectAll("path").remove();
      return;
    }
    const focus = this.focusEdges();
    const focusIds = new Set(focus.map((e) => e.id));
    const set = this.showAll ? this.resolved.edges : focus;
    const geos = this.edgeGeometries(set, focusIds);

    const baseClass = (d: EdgeGeo): string => {
      const diag = arcDiagSeverity(d.edge);
      return (
        `ref-edge status-${d.edge.status}` +
        (diag ? ` diag-${diag}` : "") +
        (d.s.collapsed || d.t.collapsed ? " collapsed" : "") +
        (d.focused ? " focused" : "")
      );
    };
    const d3path = (d: EdgeGeo): string => arcPath(d.s, d.t);
    const markerEnd = (d: EdgeGeo): string =>
      resolutionStyles[d.edge.resolution].arrowhead === "open"
        ? "url(#ref-arrow-open)"
        : "url(#ref-arrow)";
    const onClick = (event: MouseEvent, d: EdgeGeo): void => {
      event.stopPropagation();
      if (d.edge.targetDocId != null && d.edge.targetNodeId != null) {
        this.navigateTo(d.edge.targetDocId, d.edge.targetNodeId);
      }
    };
    const single = geos.filter((d) => resolutionStyles[d.edge.resolution].line === "single");
    const double = geos.filter((d) => resolutionStyles[d.edge.resolution].line === "double");

    // Single-line references: one stroke + the arrowhead.
    this.arcs
      .selectAll<SVGPathElement, EdgeGeo>("path")
      .data(single, (d) => d.edge.id)
      .join("path")
      .attr("class", baseClass)
      .attr("d", d3path)
      .attr("marker-end", markerEnd)
      .on("click", onClick);

    // Double-line references: two thin strokes offset above/below a transparent gap, plus a
    // zero-width carrier that supplies the (fixed-size) arrowhead at the centerline.
    const OFFSET = 1.4;
    const drawLine = (cls: string, dy: number): void => {
      this.arcsDouble!
        .selectAll<SVGPathElement, EdgeGeo>(`path.${cls}`)
        .data(double, (d) => d.edge.id)
        .join("path")
        .attr("class", (d) => `${baseClass(d)} dbl-line ${cls}`)
        .attr("d", d3path)
        .attr("transform", `translate(0, ${dy})`)
        .on("click", onClick);
    };
    drawLine("dbl-up", -OFFSET);
    drawLine("dbl-dn", OFFSET);
    this.arcsDouble
      .selectAll<SVGPathElement, EdgeGeo>("path.dbl-head")
      .data(double, (d) => d.edge.id)
      .join("path")
      .attr("class", (d) => `${baseClass(d)} dbl-head`)
      .attr("d", d3path)
      .attr("marker-end", markerEnd);
  }

  private edgeGeometries(edges: ReferenceEdge[], focusIds: Set<string>): EdgeGeo[] {
    const out: EdgeGeo[] = [];
    for (const edge of edges) {
      // External/broken edges have no located target. The root node's id is "" (falsy but
      // valid), so test for absence explicitly rather than truthiness.
      if (edge.targetDocId == null || edge.targetNodeId == null) continue;
      const sv = this.viewForDoc(edge.sourceDocId);
      const tv = this.viewForDoc(edge.targetDocId);
      if (!sv || !tv) continue;
      const sEnd = sv.labelEndViewport(edge.sourceNodeId);
      const sDot = sv.anchorViewport(edge.sourceNodeId);
      const t = tv.anchorViewport(edge.targetNodeId);
      if (!sEnd || !sDot || !t) continue;
      // Source leaves from the right edge of its label; target enters at its left edge.
      const s: Anchor = { x: sEnd.x + EDGE_SOURCE_GAP, y: sDot.y, collapsed: sDot.collapsed };
      const target: Anchor = { x: t.x - EDGE_TARGET_GAP, y: t.y, collapsed: t.collapsed };
      out.push({ edge, s, t: target, focused: focusIds.has(edge.id) });
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

  /** Advisory glyphs (▲) for resolved references carrying a semantic problem, in the row gutter. */
  private drawAdvisories(): void {
    if (!this.advisoryG) return;
    if (!this.resolved) {
      this.advisoryG.selectAll("text").remove();
      return;
    }
    // Group by landing row (several advisories can collapse onto one ancestor row); error
    // outranks warning for the glyph color, and every detail goes into the tooltip.
    const groups = new Map<string, { x: number; y: number; error: boolean; details: string[] }>();
    for (const edge of this.resolved.edges) {
      if (!edge.diagnostics?.length) continue;
      const sv = this.viewForDoc(edge.sourceDocId);
      if (!sv) continue;
      const p = sv.labelEndViewport(edge.sourceNodeId);
      if (!p) continue;
      const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
      const g = groups.get(key) ?? { x: p.x, y: p.y, error: false, details: [] };
      for (const d of edge.diagnostics) {
        if (d.severity === "error") g.error = true;
        g.details.push(d.detail);
      }
      groups.set(key, g);
    }
    const data = [...groups].map(([key, g]) => ({ key, ...g }));

    this.advisoryG
      .selectAll<SVGTextElement, (typeof data)[number]>("text")
      .data(data, (d) => d.key)
      .join("text")
      .attr("class", (d) => `advisory-glyph severity-${d.error ? "error" : "warning"}`)
      // Sit a little further right than the unresolved ⚠ (at +12), so the two don't collide.
      .attr("x", (d) => d.x + 30)
      .attr("y", (d) => d.y + 5)
      .attr("text-anchor", "start")
      .each(function (this: SVGTextElement, d) {
        const sel = select(this);
        sel.selectAll("*").remove();
        sel.text(null);
        sel.append("title").text(d.details.join("\n"));
        sel.append("tspan").text("▲");
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
    } else if (act === "another") {
      this.cb.onLoadAnother?.();
    }
  }
}

/**
 * The arc tint for an edge's advisories, or null. Path Item field overlaps are deliberately
 * excluded — that arc is a normal resolved `$ref` and is flagged by the gutter glyph alone; only
 * operation-target advisories (which are *about* where the arc points) tint the line.
 */
function arcDiagSeverity(edge: ReferenceEdge): "error" | "warning" | null {
  let severity: "error" | "warning" | null = null;
  for (const d of edge.diagnostics ?? []) {
    if (d.code === "pathitem-field-overlap") continue;
    if (d.severity === "error") return "error";
    severity = "warning";
  }
  return severity;
}

/** Curved cubic-bezier arc between two viewport-space anchors. */
function arcPath(s: Anchor, t: Anchor): string {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  // Always leave the source heading right and arrive at the target from its left, so the
  // arrowhead always points rightward into the target's left edge. When the target is to
  // the left (same-document refs, or a target column further left) this swings out to the
  // right before hooking back — an S-curve — instead of cutting straight left. Both control
  // points share their endpoint's y, so the curve is horizontal at each end; the arrival
  // control is long enough (and grows with the vertical drop) that the line straightens out
  // and enters the *left* side of the arrowhead rather than diving into its top or bottom.
  const out = Math.max(40, Math.min(Math.abs(dx) * 0.45, 140));
  const into = Math.max(48, Math.min(Math.abs(dx) * 0.3 + Math.abs(dy) * 0.35, 110));
  const c1x = s.x + out;
  const c2x = t.x - into;
  return `M${s.x},${s.y} C${c1x},${s.y} ${c2x},${t.y} ${t.x},${t.y}`;
}
