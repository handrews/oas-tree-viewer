// Renders one document as a collapsible, indented "filesystem" tree inside a <g> group:
// one row per visible node, children indented under their parent, expanding straight
// down. The canvas tiles these columns side by side horizontally. This class owns the
// tree itself: collapse/expand state, selection, and reporting its extent. Everything is
// drawn in SVG so future cross-document reference edges share one coordinate space.

import { hierarchy, select } from "d3";
import type { HierarchyNode, Selection } from "d3";
import type { OadDocument, TreeNode } from "../types";
import { categoryClass, categoryShape } from "./colors";
import { connectionMarker } from "../connections/style";
import { docVersionLabel } from "./detail";
import { treeKeyAction } from "./treeKeys";
import {
  COUNT_DX,
  OVERSCAN_ROWS,
  SECONDARY_DX,
  SECONDARY_MAX,
  VIRTUALIZE_ABOVE,
  estimateLabelWidth,
  windowRange,
} from "./treeLayout";

/** A hierarchy node augmented with collapsed-children storage. */
type CNode = HierarchyNode<TreeNode> & {
  _children?: CNode[];
  children?: CNode[];
};

interface RowDatum {
  node: CNode;
  depth: number;
  /** Absolute position in the full flattened row list — drives the row's y, independent of windowing. */
  index: number;
}

const ROW_H = 22; // vertical space per row
const INDENT = 20; // horizontal indent per depth level
const DOT_DX = 16; // dot offset from the row's indent
const LABEL_DX = 28; // label offset from the row's indent
const HEADER_H = 48;
const PAD = 16;
const MIN_COL_W = 360;
const LABEL_BUDGET = 300;

const TRI_CLOSED = "M-2,-4 L4,0 L-2,4 Z"; // ▶
const TRI_OPEN = "M-4,-2 L4,-2 L0,4 Z"; //   ▼

export interface DocumentViewCallbacks {
  onSelect: (doc: OadDocument, node: TreeNode) => void;
  onLayoutChanged: () => void;
  /** Keyboard focus moved to this node — the canvas scrolls it into view under the current zoom/pan. */
  onFocusNode: (nodeId: string) => void;
}

export class DocumentView {
  readonly doc: OadDocument;
  readonly group: Selection<SVGGElement, unknown, null, undefined>;
  width = 0;
  height = 0;

  private readonly treeG: Selection<SVGGElement, unknown, null, undefined>;
  private readonly rootHier: CNode;
  private readonly cb: DocumentViewCallbacks;
  private rowSel: Selection<SVGGElement, RowDatum, SVGGElement, unknown> | null = null;
  private selectedId: string | null = null;
  /** The currently-focused (roving-tabindex) row's node id — distinct from selection. */
  private activeId: string | null = null;
  /** The flat list of currently-visible rows, in keyboard (visual top-to-bottom) order. Above
   *  {@link VIRTUALIZE_ABOVE} rows only the windowed slice of this list is mounted in the DOM. */
  private visibleRows: RowDatum[] = [];
  /** Each visible row's absolute index by node id, for force-mounting the focused row. */
  private indexById = new Map<string, number>();
  /** The persistent `role="tree"` group; rows are (re)painted into it per window. */
  private treeRoot: Selection<SVGGElement, unknown, null, undefined> | null = null;
  /** Column width, computed once per structural render and reused by each window paint. */
  private colWidth = MIN_COL_W;
  /** Current viewport span in this tree's vertical coordinates (set by the canvas on zoom/resize). */
  private viewTop = 0;
  private viewBottom = Number.POSITIVE_INFINITY;
  /** The row slice currently mounted, so a window update can skip an unchanged paint. */
  private mountedStart = -1;
  private mountedEnd = -1;
  /** Current horizontal offset of this document's group within the viewport. */
  private offsetX = 0;
  /** Every node by id (incl. collapsed), for anchor/reveal lookups. */
  private readonly nodeIndex = new Map<string, CNode>();
  /** Local (pre-offset) anchor position of each currently visible row. */
  private visiblePos = new Map<string, { x: number; y: number }>();
  /** Local (pre-offset) right edge of each visible row's label, for right-gutter markers. */
  private labelEndById = new Map<string, number>();
  /** Header height for this document; grows when a distinct base URI line is shown. */
  private headerH = HEADER_H;
  /** True when no loaded reference reaches this document from the entry document. */
  private readonly unreachable: boolean;

  constructor(
    parent: SVGGElement,
    doc: OadDocument,
    cb: DocumentViewCallbacks,
    unreachable = false,
  ) {
    this.doc = doc;
    this.cb = cb;
    this.unreachable = unreachable;

    this.group = select(parent).append("g").attr("class", "doc");
    this.renderHeader();

    this.treeG = this.group
      .append("g")
      .attr("class", "tree")
      .attr("transform", `translate(${PAD}, ${this.headerH + PAD + ROW_H / 2})`);

    this.rootHier = hierarchy<TreeNode>(doc.root) as CNode;
    this.collapseDeep(this.rootHier, 0);
    walk(this.rootHier, (n) => this.nodeIndex.set(n.data.id, n));
    this.activeId = this.rootHier.data.id; // the root is the tree's initial tab stop
    this.render();
  }

  /** Total nodes in this document's tree — every row a full "Expand all" would make visible. */
  get nodeCount(): number {
    return this.nodeIndex.size;
  }

  /** The first / last currently-visible row's node id (the tree's top / bottom), for jump-to controls. */
  get firstVisibleId(): string | null {
    return this.visibleRows[0]?.node.data.id ?? null;
  }
  get lastVisibleId(): string | null {
    return this.visibleRows[this.visibleRows.length - 1]?.node.data.id ?? null;
  }

  /** Position this document's group at the given x offset (entry first => x 0). */
  setOffset(x: number): void {
    this.offsetX = x;
    this.group.attr("transform", `translate(${x}, 0)`);
  }

  /**
   * Viewport-space anchor (the row's dot) for a node, resolving a hidden node to its
   * nearest visible ancestor (`collapsed: true`). Returns null if the node isn't here.
   */
  anchorViewport(id: string): { x: number; y: number; collapsed: boolean } | null {
    if (!this.nodeIndex.has(id)) return null;
    let pos = this.visiblePos.get(id);
    let collapsed = false;
    if (!pos) {
      collapsed = true;
      let ancestor = this.nodeIndex.get(id)?.parent as CNode | null | undefined;
      while (ancestor && !this.visiblePos.has(ancestor.data.id)) {
        ancestor = ancestor.parent as CNode | null | undefined;
      }
      if (ancestor) pos = this.visiblePos.get(ancestor.data.id);
    }
    if (!pos) return null;
    return { x: this.offsetX + pos.x, y: pos.y, collapsed };
  }

  /**
   * Viewport-space anchor at the right edge of a node's label (for status markers
   * placed in the right gutter, clear of the dot/triangle). Resolves a hidden node
   * to its nearest visible ancestor's row, like {@link anchorViewport}.
   */
  labelEndViewport(id: string): { x: number; y: number } | null {
    if (!this.nodeIndex.has(id)) return null;
    let vid = id;
    let pos = this.visiblePos.get(vid);
    if (!pos) {
      let ancestor = this.nodeIndex.get(id)?.parent as CNode | null | undefined;
      while (ancestor && !this.visiblePos.has(ancestor.data.id)) {
        ancestor = ancestor.parent as CNode | null | undefined;
      }
      if (!ancestor) return null;
      vid = ancestor.data.id;
      pos = this.visiblePos.get(vid);
    }
    if (!pos) return null;
    const end = this.labelEndById.get(vid) ?? pos.x;
    return { x: this.offsetX + end, y: pos.y };
  }

  /** Expand any collapsed ancestors of `id` so its row becomes visible. */
  revealPath(id: string): void {
    const node = this.nodeIndex.get(id);
    if (!node) return;
    let changed = false;
    let ancestor = node.parent as CNode | null | undefined;
    while (ancestor) {
      if (ancestor._children) {
        ancestor.children = ancestor._children;
        ancestor._children = undefined;
        changed = true;
      }
      ancestor = ancestor.parent as CNode | null | undefined;
    }
    if (changed) {
      this.render();
      this.cb.onLayoutChanged();
    }
  }

  /** Select a node by id (no-op if absent). */
  selectById(id: string): void {
    const node = this.nodeIndex.get(id);
    if (node) this.select(node.data);
  }

  expandAll(): void {
    walk(this.rootHier, (n) => {
      if (n._children) {
        n.children = n._children;
        n._children = undefined;
      }
    });
    this.render();
    this.cb.onLayoutChanged();
  }

  collapseAll(): void {
    const collapse = (n: CNode): void => {
      if (n.children) {
        n.children.forEach(collapse);
        n._children = n.children;
        n.children = undefined;
      } else if (n._children) {
        n._children.forEach(collapse);
      }
    };
    this.rootHier.children?.forEach(collapse);
    this.render();
    this.cb.onLayoutChanged();
  }

  clearSelection(): void {
    this.selectedId = null;
    this.rowSel?.classed("selected", false);
    this.rowSel?.attr("aria-selected", "false");
  }

  // ── internals ────────────────────────────────────────────────────────────

  private collapseDeep(node: CNode, depth: number): void {
    if (!node.children) return;
    for (const child of node.children) this.collapseDeep(child, depth + 1);
    if (depth >= 2) {
      node._children = node.children;
      node.children = undefined;
    }
  }

  private toggle(node: CNode): void {
    if (node.children) {
      node._children = node.children;
      node.children = undefined;
    } else if (node._children) {
      node.children = node._children;
      node._children = undefined;
    } else {
      return; // leaf
    }
    this.render();
    this.cb.onLayoutChanged();
  }

  private select(node: TreeNode): void {
    this.selectedId = node.id;
    this.rowSel?.classed("selected", (d) => d.node.data.id === this.selectedId);
    this.rowSel?.attr("aria-selected", (d) => String(d.node.data.id === this.selectedId));
    this.cb.onSelect(this.doc, node);
  }

  /** Make `id` the roving tab stop. With `focus`, move DOM focus there and scroll it into view. If the
   *  target row had scrolled out of a windowed tree it is repainted into view first (focus-follows-window);
   *  otherwise the roving tab stop just moves on the existing rows, preserving their DOM identity. */
  private setActive(id: string, focus: boolean): void {
    this.activeId = id;
    const mounted = this.rowSel?.filter((d) => d.node.data.id === id).node();
    if (mounted) {
      this.rowSel?.attr("tabindex", (d) => (d.node.data.id === id ? 0 : -1));
    } else {
      this.paintWindow();
    }
    if (focus) {
      this.rowSel
        ?.filter((d) => d.node.data.id === id)
        .node()
        ?.focus();
      this.cb.onFocusNode(id);
    }
  }

  /**
   * WAI-ARIA Tree View keyboard handling on the focused treeitem. The decision — which node to focus,
   * toggle, or select for this key — lives in the pure {@link treeKeyAction}; this method only carries it
   * out against the d3 hierarchy. For `toggle`/`select` the action targets the focused node itself, so it
   * uses `node` directly; `focus` targets another visible row, addressed by id.
   */
  private onKeydown(event: KeyboardEvent, d: RowDatum): void {
    const node = d.node;
    const action = treeKeyAction({
      key: event.key,
      visibleIds: this.visibleRows.map((r) => r.node.data.id),
      focusedId: node.data.id,
      node: {
        collapsed: Boolean(node._children),
        expanded: Boolean(node.children),
        firstChildId: node.children?.[0]?.data.id ?? null,
        parentId: (node.parent as CNode | null)?.data.id ?? null,
      },
    });
    if (!action) return; // a key the tree doesn't handle — leave the event alone
    event.preventDefault();
    switch (action.type) {
      case "focus":
        this.setActive(action.id, true);
        break;
      case "toggle":
        this.toggle(node); // expand/collapse, keeping focus here
        this.setActive(node.data.id, true);
        break;
      case "select":
        this.select(node.data); // selection is explicit (Enter/Space), distinct from focus
        break;
      case "none":
        break;
    }
  }

  /**
   * Structural pass: flatten the visible nodes into the full row list and compute everything that depends
   * on the tree shape (analytic positions, label ends, keyboard order, extent), then paint the current
   * window. Cheap regardless of size — no DOM is touched per row here; {@link paintWindow} mounts only the
   * rows near the viewport.
   */
  private render(): void {
    const rows: RowDatum[] = [];
    let maxDepth = 0;
    const visit = (node: CNode, depth: number): void => {
      rows.push({ node, depth, index: rows.length });
      if (depth > maxDepth) maxDepth = depth;
      node.children?.forEach((child) => visit(child, depth + 1));
    };
    visit(this.rootHier, 0);
    this.visibleRows = rows;
    this.indexById = new Map(rows.map((r) => [r.node.data.id, r.index]));

    // Keep exactly one roving tab stop: the active node if still visible, else the root row.
    const visibleIds = new Set(rows.map((r) => r.node.data.id));
    this.activeId =
      this.activeId && visibleIds.has(this.activeId)
        ? this.activeId
        : (rows[0]?.node.data.id ?? null);

    this.colWidth = Math.max(MIN_COL_W, maxDepth * INDENT + LABEL_BUDGET);

    // Each row's dot position and label end, analytic (no DOM): the label end is estimated rather than
    // measured, which keeps this off the synchronous-reflow path and stays valid for unmounted rows.
    this.visiblePos = new Map();
    this.labelEndById = new Map();
    for (const r of rows) {
      const data = r.node.data;
      this.visiblePos.set(data.id, {
        x: PAD + r.depth * INDENT + DOT_DX,
        y: this.headerH + PAD + ROW_H / 2 + r.index * ROW_H,
      });
      this.labelEndById.set(
        data.id,
        PAD +
          r.depth * INDENT +
          LABEL_DX +
          estimateLabelWidth(
            primaryLabel(data),
            secondaryLabel(data),
            r.node._children?.length ?? 0,
          ),
      );
    }

    // Rebuild the persistent accessible tree group. Its name carries the document identity (the visual
    // header is aria-hidden), and the shared keyboard hint describes the controls.
    this.treeG.selectAll("*").remove();
    const entryFlag = this.doc.isEntry
      ? " (entry document)"
      : this.unreachable
        ? " (unreachable)"
        : "";
    this.treeRoot = this.treeG
      .append("g")
      .attr("class", "rows")
      .attr("role", "tree")
      .attr("aria-label", `${headerTitle(this.doc)} · ${docVersionLabel(this.doc)}${entryFlag}`)
      .attr("aria-describedby", "tree-help");

    this.height = this.headerH + PAD + rows.length * ROW_H + PAD;
    this.width = this.colWidth + PAD;

    this.mountedStart = -1; // force a paint; the fresh treeRoot has no rows yet
    this.mountedEnd = -1;
    this.paintWindow();
  }

  /** The half-open row range to mount for the current viewport — the whole tree below the threshold. */
  private windowSlice(): { start: number; end: number } {
    const total = this.visibleRows.length;
    if (total <= VIRTUALIZE_ABOVE) return { start: 0, end: total };
    return windowRange(
      total,
      this.viewTop,
      this.viewBottom,
      ROW_H,
      this.headerH + PAD + ROW_H / 2,
      OVERSCAN_ROWS,
    );
  }

  /**
   * Mount only the rows in the current window, plus the active row so the roving tab stop is always present.
   * Rows are cleared and rebuilt within one frame (no intermediate paint, so no flicker); the slice is
   * bounded by the viewport, not the tree, so this stays cheap as the tree grows.
   */
  private paintWindow(): void {
    if (!this.treeRoot) return;
    const { start, end } = this.windowSlice();
    this.mountedStart = start;
    this.mountedEnd = end;

    const slice = this.visibleRows.slice(start, end);
    const activeIdx = this.activeId != null ? this.indexById.get(this.activeId) : undefined;
    if (activeIdx !== undefined && (activeIdx < start || activeIdx >= end)) {
      slice.push(this.visibleRows[activeIdx]!);
    }

    this.treeRoot.selectAll("g.row").remove();
    const rowSel = this.treeRoot
      .selectAll<SVGGElement, RowDatum>("g.row")
      .data(slice)
      .join("g")
      .attr("class", "row")
      .attr("role", "treeitem")
      .attr("aria-level", (d) => d.depth + 1)
      .attr("aria-setsize", (d) => siblingCount(d.node))
      .attr("aria-posinset", (d) => siblingIndex(d.node))
      .attr("aria-selected", (d) => String(d.node.data.id === this.selectedId))
      // Expandable rows announce their state; leaves omit aria-expanded entirely.
      .attr("aria-expanded", (d) => (hasChildren(d.node) ? String(Boolean(d.node.children)) : null))
      .attr("aria-label", (d) => ariaName(d.node))
      .attr("tabindex", (d) => (d.node.data.id === this.activeId ? 0 : -1))
      .classed("selected", (d) => d.node.data.id === this.selectedId)
      .attr("transform", (d) => `translate(0, ${d.index * ROW_H})`)
      .on("click", (event: MouseEvent, d) => {
        event.stopPropagation();
        this.select(d.node.data);
      })
      .on("dblclick", (event: MouseEvent, d) => {
        event.stopPropagation();
        this.toggle(d.node);
      })
      .on("keydown", (event: KeyboardEvent, d) => this.onKeydown(event, d))
      .on("focus", (_event: FocusEvent, d) => {
        this.activeId = d.node.data.id; // keep the roving tab stop in sync with DOM focus (e.g. Tab-in)
      });

    // Full-width transparent hit/hover background per row.
    rowSel
      .append("rect")
      .attr("class", "row-bg")
      .attr("x", -PAD / 2)
      .attr("y", -ROW_H / 2)
      .attr("width", this.colWidth)
      .attr("height", ROW_H);

    // Disclosure triangle for expandable nodes.
    rowSel
      .filter((d) => hasChildren(d.node))
      .append("path")
      .attr("class", "disclosure")
      .attr("transform", (d) => `translate(${d.depth * INDENT + 4}, 0)`)
      .attr("d", (d) => (d.node.children ? TRI_OPEN : TRI_CLOSED))
      .on("click", (event: MouseEvent, d) => {
        event.stopPropagation();
        this.toggle(d.node);
      });

    // Colored category / reference markers (see the module-level marker helpers below).
    rowSel
      .filter((d) => isRefField(d) && refMarker(d) === "asterisk")
      .append("path")
      .attr("class", "marker asterisk cat-structural")
      .attr("d", "M0,-5 L0,5 M-4.33,-2.5 L4.33,2.5 M-4.33,2.5 L4.33,-2.5")
      .attr("transform", (d) => `translate(${markerX(d)}, 0)`);

    rowSel
      .filter((d) => isRefField(d) && refMarker(d) === "diamond")
      .append("path")
      .attr("class", "marker diamond cat-structural")
      .attr("d", "M0,-5 L5,0 L0,5 L-5,0 Z")
      .attr("transform", (d) => `translate(${markerX(d)}, 0)`);

    rowSel
      .filter((d) => !isRefField(d) && categoryShape(d.node.data.category) === "circle")
      .append("circle")
      .attr("class", markerClass)
      .attr("r", 4)
      .attr("cx", markerX)
      .attr("cy", 0);

    rowSel
      .filter((d) => !isRefField(d) && categoryShape(d.node.data.category) === "square")
      .append("rect")
      .attr("class", markerClass)
      .attr("width", 8)
      .attr("height", 8)
      .attr("x", (d) => markerX(d) - 4)
      .attr("y", -4)
      .attr("rx", 1);

    // Single-line label: key, optional collapsed-count, then dim type/value.
    const label = rowSel
      .append("text")
      .attr("class", "node-label")
      .attr("x", (d) => d.depth * INDENT + LABEL_DX)
      .attr("dy", "0.32em")
      .attr("text-anchor", "start");

    label.each(function (this: SVGTextElement, d: RowDatum) {
      const sel = select(this);
      sel.append("tspan").attr("class", "k").text(primaryLabel(d.node.data));
      const hidden = d.node._children?.length;
      if (hidden) {
        sel
          .append("tspan")
          .attr("class", "count")
          .attr("dx", String(COUNT_DX))
          .text(`(+${hidden})`);
      }
      const secondary = secondaryLabel(d.node.data);
      if (secondary) {
        sel
          .append("tspan")
          .attr("class", "t")
          .attr("dx", String(SECONDARY_DX))
          .text(truncate(secondary, SECONDARY_MAX));
      }
    });

    this.rowSel = rowSel;
  }

  /**
   * Set the viewport span (in this tree's vertical coordinates) the canvas currently shows, so a large tree
   * only mounts the rows near it. Repaints only when the windowed slice actually changes; a no-op for a tree
   * small enough to render whole.
   */
  setViewport(top: number, bottom: number): void {
    this.viewTop = top;
    this.viewBottom = bottom;
    if (this.visibleRows.length <= VIRTUALIZE_ABOVE) return;
    const { start, end } = this.windowSlice();
    if (start === this.mountedStart && end === this.mountedEnd) return;
    this.paintWindow();
  }

  private renderHeader(): void {
    // Show the resolution base URI only when it differs from the retrieval URL already
    // on the sub line (i.e. a $self that re-bases the document, e.g. in OAS 3.2).
    const base = this.doc.selfUri ?? this.doc.retrievalUri;
    const showBase = base !== undefined && base !== this.doc.retrievalUri;
    if (showBase) this.headerH = HEADER_H + 14;

    // The header is decorative for AT — its identity is folded into the tree's accessible name.
    const h = this.group
      .append("g")
      .attr("class", this.unreachable ? "doc-header unreachable" : "doc-header")
      .attr("aria-hidden", "true");
    h.append("rect")
      .attr("class", "doc-header-bg")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", 380)
      .attr("height", this.headerH - 10)
      .attr("rx", 6);

    h.append("text")
      .attr("class", "doc-title")
      .attr("x", 12)
      .attr("y", 19)
      .text(headerTitle(this.doc));

    const sub =
      `${docVersionLabel(this.doc)} · ${this.doc.format}` +
      (this.doc.retrievalUri ? ` · ${this.doc.retrievalUri}` : "");
    h.append("text").attr("class", "doc-sub").attr("x", 12).attr("y", 33).text(truncate(sub, 64));

    if (showBase) {
      h.append("text")
        .attr("class", "doc-base")
        .attr("x", 12)
        .attr("y", 47)
        .text(truncate(`base: ${base}`, 62));
    }

    if (this.doc.isEntry) {
      const badge = h
        .append("g")
        .attr("class", "entry-badge")
        .attr("transform", "translate(320, 7)");
      badge.append("rect").attr("width", 52).attr("height", 16).attr("rx", 8);
      badge.append("text").attr("x", 26).attr("y", 12).attr("text-anchor", "middle").text("ENTRY");
    } else if (this.unreachable) {
      // The entry is reachable by definition, so this never collides with the entry badge.
      const badge = h
        .append("g")
        .attr("class", "warn-badge")
        .attr("transform", "translate(286, 7)");
      badge.append("rect").attr("width", 86).attr("height", 16).attr("rx", 8);
      badge
        .append("text")
        .attr("x", 43)
        .attr("y", 12)
        .attr("text-anchor", "middle")
        .text("UNREACHABLE");
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function walk(node: CNode, fn: (n: CNode) => void): void {
  fn(node);
  const kids = node.children ?? node._children;
  kids?.forEach((k) => walk(k, fn));
}

// Row marker helpers. A reference-pointer row ($ref / operationRef, a Discriminator `mapping` value or a
// Security Requirement key) is drawn in the Structural color with a shape that reflects how it resolved
// (asterisk for a URI-reference, diamond for a component name); every other node uses its category color,
// shaped as a square (object/array/scalar) or a circle, drawn hollow when collapsed.
function isRefField(d: RowDatum): boolean {
  const n = d.node.data;
  if (n.componentRef) return true;
  if (n.valueKind !== "string") return false;
  if (n.key === "$ref") return Boolean(d.node.parent?.data.isReference);
  if (n.key === "operationRef") return true;
  if (n.key === "$dynamicRef") return true; // a Schema's $dynamicRef pointer
  if (n.key === "$recursiveRef") return true; // a 2019-09 Schema's $recursiveRef pointer
  // A Link's operationId is a reference pointer; an Operation's own operationId
  // declaration (same key, different parent) is a plain field, not a pointer.
  return n.key === "operationId" && d.node.parent?.data.oasType === "Link Object";
}

function refMarker(d: RowDatum): string {
  return connectionMarker(d.node.data.resolvedAs ?? "uri-reference");
}

function markerClass(d: RowDatum): string {
  const parts = ["marker", categoryClass(d.node.data.category)];
  if (d.node._children) parts.push("collapsed");
  return parts.join(" ");
}

function markerX(d: RowDatum): number {
  return d.depth * INDENT + DOT_DX;
}

function hasChildren(node: CNode): boolean {
  return Boolean(node.children?.length || node._children?.length);
}

/** Visible-sibling count / 1-based position, for aria-setsize/aria-posinset on the flat (DOM) tree. */
function siblingCount(node: CNode): number {
  const siblings = (node.parent as CNode | null)?.children;
  return siblings ? siblings.length : 1;
}
function siblingIndex(node: CNode): number {
  const siblings = (node.parent as CNode | null)?.children;
  return siblings ? siblings.indexOf(node) + 1 : 1;
}

/** A treeitem's accessible name: key, then its type/target/value, then any hidden-child count — read
 *  more naturally than the visual label (e.g. "references …"/"is …" instead of the "→"/":" glyphs). */
function ariaName(node: CNode): string {
  const data = node.data;
  const secondary = secondaryLabel(data).replace(/^→\s*/, "references ").replace(/^:\s*/, "is ");
  const hidden = node._children?.length;
  return [primaryLabel(data), secondary, hidden ? `${hidden} hidden` : ""]
    .filter(Boolean)
    .join(", ");
}

function headerTitle(doc: OadDocument): string {
  return doc.filename ?? doc.retrievalUri ?? `(${doc.source} document)`;
}

function primaryLabel(node: TreeNode): string {
  if (node.keyKind === "root") return node.oasType ?? "(document root)";
  if (node.keyKind === "index") return `[${node.key}]`;
  return node.key ?? "";
}

function secondaryLabel(node: TreeNode): string {
  if (node.isReference && node.refTarget) return `→ ${node.refTarget}`;
  if (node.valueKind === "object" || node.valueKind === "array") {
    return node.keyKind === "root" ? "" : (node.oasType ?? "");
  }
  return `: ${scalarPreview(node.scalarValue)}`;
}

function scalarPreview(value: string | number | boolean | null | undefined): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
