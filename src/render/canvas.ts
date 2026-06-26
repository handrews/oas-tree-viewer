// The shared zoom/pan SVG canvas. Hosts one DocumentView per document (tiled left to
// right, entry first) and an overlay layer that draws reference edges as on-demand curved
// arcs across the single shared coordinate space.

import { select, zoom, zoomIdentity, zoomTransform } from "d3";
import type { Selection, ZoomBehavior } from "d3";
import type { Oad, OadDocument, TreeNode } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "../refs/types";
import { ADVISORY_CODES as REF_ADVISORY_CODES, refKey } from "../refs/types";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/types";
import { emittedSeverity, severityFor } from "../diagnostics/catalog";
import { indexByPointer } from "../diagnostics/runner";
import { arrowheadMarkerId, connectionClasses, isDoubleLine } from "../connections/style";
import { MAX_RENDER_EDGES } from "../limits";
import { DocumentView } from "./treeView";

// Which diagnostic codes drive each right-gutter glyph: a ⚠ for an unresolved reference, a ⚠ for a
// node-level resolution caveat (unsupported dialect / draft-06-07 rule), and a ▲ for a resolved-but-
// problematic reference advisory. Codes not listed here (type mismatches, document-level findings) get
// no gutter glyph — they surface via the arc style, the header badge, or the issue report.
const REF_WARN_CODES = new Set<DiagnosticCode>(["ref-broken", "ref-external"]);
const CAVEAT_CODES = new Set<DiagnosticCode>([
  "dialect-resolution-unsupported",
  "ignored-ref-siblings",
  "invalid-id-fragment",
]);
const ADVISORY_CODES = new Set<DiagnosticCode>(REF_ADVISORY_CODES);

const DOC_GAP = 56;
// Zoom limits. The minimum also bounds windowing: the viewport can never show more than ~`viewport
// height / (MIN_SCALE * row height)` rows, so even "Fit" on a huge tree mounts a bounded slice (it frames
// the top and the user pans) rather than zooming out until every row is on screen at once.
const MIN_SCALE = 0.08;
const MAX_SCALE = 3;
// Mount this fraction of the visible band as extra rows above and below it, so a fast pan or zoom doesn't
// outrun the window before the next frame repaints (the band is hundreds of rows when zoomed out).
const WINDOW_MARGIN = 0.6;
// Reference arcs enter the target from the left, with the arrowhead sitting clear to the left of the
// target's disclosure triangle (which starts ~16px left of the node marker) rather than on top.
const EDGE_TARGET_GAP = 20;

// Right-gutter layout. Everything that sits past a row's label — the reference arc's source, the
// unresolved/caveat ⚠, and the resolved-advisory ▲ — anchors at the same point (the label's right end,
// `labelEndViewport`) and is placed by a fixed x offset from it. The offsets live together because the
// one constraint that matters is that they not collide: the arc leaves at `edgeSourceX`, the ⚠ sits just
// past it, and the ▲ further right so it clears the ⚠. (A future change could replace these hand-tuned
// values with measured packing — see the deferred gutter-layout work.)
const GUTTER = {
  /** Where a reference edge leaves its source row. */
  edgeSourceX: 10,
  /** Unresolved-reference / resolution-caveat ⚠ glyph. */
  warnX: 12,
  warnY: 6,
  /** Resolved-but-problematic advisory ▲ glyph (further right, clear of the ⚠). */
  advisoryX: 30,
  advisoryY: 5,
} as const;

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
  /** Unified diagnostics indexed by docId → pointer → Diagnostic[]; the gutter glyphs derive from it. */
  private diagnostics = new Map<string, Map<string, Diagnostic[]>>();
  private focusKey: string | null = null;
  private showAll = false;
  /** Pending requestAnimationFrame handle that coalesces a burst of zoom/pan events into one window pass. */
  private windowRaf = 0;

  constructor(container: HTMLElement, cb: CanvasCallbacks) {
    this.cb = cb;
    container.innerHTML = "";

    const toolbar = document.createElement("div");
    toolbar.className = "canvas-toolbar";
    toolbar.innerHTML = `
      <button type="button" data-act="fit">Fit</button>
      <button type="button" data-act="top" title="Jump to the top of the tree">Top</button>
      <button type="button" data-act="bottom" title="Jump to the bottom of the tree">Bottom</button>
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

    // A group of keyboard-navigable trees (one per document), not a single opaque image — so do NOT
    // use role="img" (which would hide the trees from assistive tech).
    this.svg = select(container)
      .append("svg")
      .attr("class", "tree-canvas")
      .attr("role", "group")
      .attr("aria-label", "OpenAPI Description document trees")
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
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .on("zoom", (event) => {
        this.viewport.attr("transform", event.transform.toString());
        this.scheduleWindowUpdate(); // re-window the trees as the visible area changes
      });
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
          onFocusNode: (nodeId) => this.recenterNode(doc.id, nodeId),
        },
        unreachableDocIds.has(doc.id),
      );
      this.views.push(view);
    }

    // Edge overlay sits above the document groups. Arcs duplicate (visually) the reference info already
    // in the accessible detail panel, so the whole layer is hidden from assistive tech.
    const edgeLayer = this.viewport.append("g").attr("class", "edges").attr("aria-hidden", "true");
    this.warnG = edgeLayer.append("g").attr("class", "warnings");
    // Advisory glyphs (resolved-but-problematic references) sit beside the unresolved ⚠ glyphs.
    this.advisoryG = edgeLayer.append("g").attr("class", "advisories");
    this.arcs = edgeLayer.append("g").attr("class", "arcs");
    // Component-name arcs render as two offset lines (a transparent gap between) so they read
    // as a double line yet stay legible where they cross labels.
    this.arcsDouble = edgeLayer.append("g").attr("class", "arcs-double");

    this.retile();
    // Seed each view's viewport from the current transform before the fit transition runs, so a large tree
    // expanded right away (e.g. "Load anyway" then "Expand all") only ever mounts the rows in view.
    this.updateWindows();
    this.fit();
  }

  /** Provide resolved references; draws any active edges (arcs). */
  setReferences(resolved: ResolvedRefs): void {
    this.resolved = resolved;
    this.focusKey = null;
    this.refreshEdges();
  }

  /** Provide the unified diagnostics; (re)draws the right-gutter warning + advisory glyphs from them. */
  setDiagnostics(diagnostics: Diagnostic[]): void {
    this.diagnostics = indexByPointer(diagnostics);
    this.drawWarnings();
    this.drawAdvisories();
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

  /** Scroll a keyboard-focused node into view without changing selection (no reveal — it's visible). */
  private recenterNode(docId: string, nodeId: string): void {
    const anchor = this.viewForDoc(docId)?.anchorViewport(nodeId);
    if (anchor) this.recenter(anchor.x, anchor.y);
  }

  fit(): void {
    const svgNode = this.svg.node();
    if (!svgNode) return;

    // Analytic content extent (sum of view widths, tallest view) rather than getBBox — which would now
    // measure only the *mounted* rows of a windowed tree, not its full height.
    const { width: bw, height: bh } = this.contentExtent();
    if (bw === 0 || bh === 0) return;

    const sw = svgNode.clientWidth || 900;
    const sh = svgNode.clientHeight || 600;
    const margin = 48;
    // Never zoom out past the interactive minimum: a tree taller than the viewport at MIN_SCALE is framed
    // from the top (and panned), so the mounted window stays bounded instead of covering every row.
    const k = Math.max(MIN_SCALE, Math.min((sw - margin) / bw, (sh - margin) / bh, 1.2));
    const scaledW = bw * k;
    const scaledH = bh * k;
    // Content starts at the origin (header rect at 0,0), so no bbox offset to subtract.
    const tx = scaledW < sw ? (sw - scaledW) / 2 : 24;
    const ty = scaledH < sh ? (sh - scaledH) / 2 : 24;

    this.svg
      .transition()
      .duration(300)
      .call(this.zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Whole-canvas content size from the views' analytic extents (entry first, tiled left to right). */
  private contentExtent(): { width: number; height: number } {
    let width = 0;
    let height = 0;
    for (const view of this.views) {
      width += view.width + DOC_GAP;
      height = Math.max(height, view.height);
    }
    return { width: Math.max(0, width - DOC_GAP), height };
  }

  /** The visible viewport in the shared content (viewport-group) coordinate space, inverting the zoom. */
  private currentViewBounds(): { top: number; bottom: number } | null {
    const svgNode = this.svg.node();
    if (!svgNode) return null;
    const t = zoomTransform(svgNode);
    const sh = svgNode.clientHeight || 600;
    const top = (0 - t.y) / t.k;
    const bottom = (sh - t.y) / t.k;
    const margin = (bottom - top) * WINDOW_MARGIN;
    return { top: top - margin, bottom: bottom + margin };
  }

  /** Push the current visible y-range to every view, so each mounts only the rows near it. */
  private updateWindows(): void {
    const bounds = this.currentViewBounds();
    if (!bounds) return;
    for (const view of this.views) view.setViewport(bounds.top, bounds.bottom);
  }

  /** Coalesce a burst of zoom/pan events into a single window pass on the next frame. */
  private scheduleWindowUpdate(): void {
    if (this.windowRaf) return;
    this.windowRaf = requestAnimationFrame(() => {
      this.windowRaf = 0;
      this.updateWindows();
    });
  }

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

    // The connection style catalog (src/connections) selects the base look (line/dash/arrowhead/marker);
    // the modifier axes — resolve status, advisory severity, collapsed/off-screen endpoint, focus — are
    // render state layered on here. One pure helper builds the class list so the canvas and the legend
    // can't drift.
    const baseClass = (d: EdgeGeo): string =>
      connectionClasses(d.edge.resolution, {
        status: d.edge.status,
        advisory: arcDiagSeverity(d.edge),
        collapsed: d.s.collapsed || d.t.collapsed,
        focused: d.focused,
      }).join(" ");
    const d3path = (d: EdgeGeo): string => arcPath(d.s, d.t);
    const markerEnd = (d: EdgeGeo): string => `url(#${arrowheadMarkerId(d.edge.resolution)})`;
    const onClick = (event: MouseEvent, d: EdgeGeo): void => {
      event.stopPropagation();
      if (d.edge.targetDocId != null && d.edge.targetNodeId != null) {
        this.navigateTo(d.edge.targetDocId, d.edge.targetNodeId);
      }
    };
    const double = geos.filter((d) => isDoubleLine(d.edge.resolution));
    const single = geos.filter((d) => !isDoubleLine(d.edge.resolution));

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
      this.arcsDouble!.selectAll<SVGPathElement, EdgeGeo>(`path.${cls}`)
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
      const s: Anchor = { x: sEnd.x + GUTTER.edgeSourceX, y: sDot.y, collapsed: sDot.collapsed };
      const target: Anchor = { x: t.x - EDGE_TARGET_GAP, y: t.y, collapsed: t.collapsed };
      out.push({ edge, s, t: target, focused: focusIds.has(edge.id) });
    }
    return out;
  }

  private drawWarnings(): void {
    if (!this.warnG) return;

    const data: WarnDatum[] = [];

    // All glyphs derive from the unified diagnostics, located by JSON Pointer. Per document: unresolved-
    // reference ⚠ glyphs are grouped by the row they land on (several can collapse onto the same ancestor
    // row), `broken` outranking `external`; node-level resolution caveats each render their own ⚠.
    for (const view of this.views) {
      const byPtr = this.diagnostics.get(view.doc.id);
      if (!byPtr) continue;
      const refGroups = new Map<string, { x: number; y: number; broken: boolean; count: number }>();
      for (const [pointer, diags] of byPtr) {
        const refWarns = diags.filter((d) => REF_WARN_CODES.has(d.code));
        const caveats = diags.filter((d) => CAVEAT_CODES.has(d.code));
        if (!refWarns.length && !caveats.length) continue;
        // Anchor in the right gutter, past the label, clear of the dot/triangle.
        const p = view.labelEndViewport(pointer);
        if (!p) continue;
        if (refWarns.length) {
          const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
          const g = refGroups.get(key) ?? { x: p.x, y: p.y, broken: false, count: 0 };
          for (const d of refWarns) {
            g.count += 1;
            if (d.code === "ref-broken") g.broken = true;
          }
          refGroups.set(key, g);
        }
        if (caveats.length) {
          data.push({
            key: `caveat:${view.doc.id}:${pointer}`,
            kind: "dialect",
            x: p.x,
            y: p.y,
            title: caveats.map((d) => d.message).join("\n"),
          });
        }
      }
      for (const [key, g] of refGroups) {
        data.push({ key: `ref:${view.doc.id}:${key}`, kind: "ref", ...g });
      }
    }

    this.warnG
      .selectAll<SVGTextElement, WarnDatum>("text")
      .data(data, (d) => d.key)
      .join("text")
      .attr("class", (d) =>
        d.kind === "dialect"
          ? "warn-glyph status-dialect"
          : `warn-glyph status-${d.broken ? "broken" : "external"}`,
      )
      .attr("x", (d) => d.x + GUTTER.warnX)
      .attr("y", (d) => d.y + GUTTER.warnY)
      .attr("text-anchor", "start")
      .each(function (this: SVGTextElement, d) {
        const sel = select(this);
        sel.selectAll("*").remove();
        sel.text(null);
        if (d.kind === "dialect") {
          sel.append("title").text(d.title);
          sel.append("tspan").text("⚠");
          return;
        }
        sel
          .append("title")
          .text(
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
    // Resolved-but-problematic reference advisories, from the unified diagnostics. Group by landing row
    // (several can collapse onto one ancestor row); error outranks warning for the glyph color, and every
    // detail goes into the tooltip.
    const groups = new Map<string, { x: number; y: number; error: boolean; details: string[] }>();
    for (const view of this.views) {
      const byPtr = this.diagnostics.get(view.doc.id);
      if (!byPtr) continue;
      for (const [pointer, diags] of byPtr) {
        const advs = diags.filter((d) => ADVISORY_CODES.has(d.code));
        if (!advs.length) continue;
        const p = view.labelEndViewport(pointer);
        if (!p) continue;
        const key = `${view.doc.id}:${Math.round(p.x)}:${Math.round(p.y)}`;
        const g = groups.get(key) ?? { x: p.x, y: p.y, error: false, details: [] };
        for (const d of advs) {
          if (d.severity === "error") g.error = true;
          g.details.push(d.message);
        }
        groups.set(key, g);
      }
    }
    const data = [...groups].map(([key, g]) => ({ key, ...g }));

    this.advisoryG
      .selectAll<SVGTextElement, (typeof data)[number]>("text")
      .data(data, (d) => d.key)
      .join("text")
      .attr("class", (d) => `advisory-glyph severity-${d.error ? "error" : "warning"}`)
      .attr("x", (d) => d.x + GUTTER.advisoryX)
      .attr("y", (d) => d.y + GUTTER.advisoryY)
      .attr("text-anchor", "start")
      .each(function (this: SVGTextElement, d) {
        const sel = select(this);
        sel.selectAll("*").remove();
        sel.text(null);
        sel.append("title").text(d.details.join("\n"));
        sel.append("tspan").text("▲");
      });
  }

  /** Center the viewport on a content point. `animate` pans there over a short transition (good for a
   *  short hop like an edge click); without it the move is instant — used for the long top/bottom jumps,
   *  where animating sweeps the whole tree past at once (rebuilding the window every frame) and just looks
   *  like the canvas froze. */
  private recenter(x: number, y: number, animate = true): void {
    const svgNode = this.svg.node();
    if (!svgNode) return;
    const k = zoomTransform(svgNode).k;
    const sw = svgNode.clientWidth || 900;
    const sh = svgNode.clientHeight || 600;
    const target = zoomIdentity.translate(sw / 2 - k * x, sh / 2 - k * y).scale(k);
    if (animate) {
      this.svg.transition().duration(400).call(this.zoomBehavior.transform, target);
    } else {
      this.svg.call(this.zoomBehavior.transform, target);
    }
  }

  /** Recenter on the first / last node of the entry document — for jumping a tall tree whose ends the
   *  current zoom can't show at once. The target may be off-window; its position is known analytically.
   *  The jump is instant (not animated) so a long sweep doesn't look like a stuck/blank canvas. */
  private jumpTo(end: "top" | "bottom"): void {
    const view = this.views[0];
    if (!view) return;
    const id = end === "top" ? view.firstVisibleId : view.lastVisibleId;
    if (id == null) return;
    const anchor = view.anchorViewport(id);
    if (anchor) this.recenter(anchor.x, anchor.y, false);
  }

  private onToolbar(e: MouseEvent): void {
    const act = (e.target as HTMLElement).getAttribute("data-act");
    if (act === "fit") {
      this.fit();
    } else if (act === "top" || act === "bottom") {
      this.jumpTo(act);
    } else if (act === "expand") {
      // Expanding is cheap regardless of size: the tree is windowed, so only the rows near the viewport
      // are ever mounted (the rest are tracked analytically). No confirmation needed.
      this.views.forEach((v) => v.expandAll());
      this.fit();
    } else if (act === "collapse") {
      this.views.forEach((v) => v.collapseAll());
      this.fit();
    } else if (act === "showall") {
      // Same hazard when drawing every reference arc at once; gate turning it on, not off.
      const edges = this.resolved?.edges.length ?? 0;
      if (!this.showAll && edges > MAX_RENDER_EDGES && !this.confirmHeavyRender(edges)) {
        return;
      }
      this.showAll = !this.showAll;
      this.showAllBtn.classList.toggle("active", this.showAll);
      this.showAllBtn.setAttribute("aria-pressed", String(this.showAll));
      this.refreshEdges();
    } else if (act === "another") {
      this.cb.onLoadAnother?.();
    }
  }

  /** Ask before drawing every reference arc at once: a perf hazard on a big graph, and — on a large or
   *  very tall document — a rendering one (the arcs become long near-vertical lines that the browser
   *  re-rasterizes each pan frame, with arrowheads that angle oddly). Returns true to proceed. */
  private confirmHeavyRender(count: number): boolean {
    return window.confirm(
      `This will draw ${count.toLocaleString()} reference arcs at once, which may make the page slow or ` +
        `unresponsive. On a large or very tall document the arcs may also render imperfectly — misangled ` +
        `arrowheads, or lines that flicker while panning. Continue?`,
    );
  }
}

/** A right-gutter warning glyph: an unresolved reference, or an unsupported-dialect field. */
type WarnDatum =
  | { key: string; kind: "ref"; x: number; y: number; broken: boolean; count: number }
  | { key: string; kind: "dialect"; x: number; y: number; title: string };

/**
 * The arc tint for an edge's advisories, or null. Severity comes from the diagnostic catalog policy —
 * the same configurable source the ▲ gutter glyph reads — so a severity change (or `off`) moves the arc
 * and the glyph together. Path Item field overlaps are deliberately excluded: that arc is a normal
 * resolved `$ref` and is flagged by the gutter glyph alone; only operation-target advisories (which are
 * *about* where the arc points) tint the line.
 */
function arcDiagSeverity(edge: ReferenceEdge): "error" | "warning" | null {
  let severity: "error" | "warning" | null = null;
  for (const d of edge.diagnostics ?? []) {
    if (d.code === "pathitem-field-overlap") continue;
    const sev = emittedSeverity(severityFor(d.code));
    if (sev === "error") return "error";
    if (sev === "warning") severity = "warning";
    // `off` (null) or `info` contributes no tint.
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
