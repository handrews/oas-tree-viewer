// Renders one document as a collapsible, indented "filesystem" tree inside a <g> group:
// one row per visible node, children indented under their parent, expanding straight
// down. The canvas tiles these columns side by side horizontally. This class owns the
// tree itself: collapse/expand state, selection, and reporting its extent. Everything is
// drawn in SVG so future cross-document reference edges share one coordinate space.

import { hierarchy, select } from "d3";
import type { HierarchyNode, Selection } from "d3";
import type { OadDocument, TreeNode } from "../types";
import { categoryClass, categoryShape, resolutionStyles } from "./colors";
import { docVersionLabel } from "./detail";
import { treeKeyAction } from "./treeKeys";

/** A hierarchy node augmented with collapsed-children storage. */
type CNode = HierarchyNode<TreeNode> & {
  _children?: CNode[];
  children?: CNode[];
};

interface RowDatum {
  node: CNode;
  depth: number;
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
  /** The flat list of currently-visible rows, in keyboard (visual top-to-bottom) order. */
  private visibleRows: RowDatum[] = [];
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

  /** Make `id` the roving tab stop. With `focus`, move DOM focus there and scroll it into view. */
  private setActive(id: string, focus: boolean): void {
    this.activeId = id;
    if (!this.rowSel) return;
    this.rowSel.attr("tabindex", (d) => (d.node.data.id === id ? 0 : -1));
    if (focus) {
      this.rowSel
        .filter((d) => d.node.data.id === id)
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

  private render(): void {
    // Flatten visible nodes depth-first into rows.
    const rows: RowDatum[] = [];
    let maxDepth = 0;
    const visit = (node: CNode, depth: number): void => {
      rows.push({ node, depth });
      if (depth > maxDepth) maxDepth = depth;
      node.children?.forEach((child) => visit(child, depth + 1));
    };
    visit(this.rootHier, 0);

    // Keyboard order is the visible top-to-bottom list. Keep exactly one roving tab stop: the active
    // node if it is still visible, else the root row.
    this.visibleRows = rows;
    const visibleIds = new Set(rows.map((r) => r.node.data.id));
    const tabbableId =
      this.activeId && visibleIds.has(this.activeId)
        ? this.activeId
        : (rows[0]?.node.data.id ?? null);
    this.activeId = tabbableId;

    const colWidth = Math.max(MIN_COL_W, maxDepth * INDENT + LABEL_BUDGET);

    // Record each visible row's local dot position for edge anchoring.
    this.visiblePos = new Map();
    this.labelEndById = new Map();
    rows.forEach((r, i) => {
      this.visiblePos.set(r.node.data.id, {
        x: PAD + r.depth * INDENT + DOT_DX,
        y: this.headerH + PAD + ROW_H / 2 + i * ROW_H,
      });
    });

    this.treeG.selectAll("*").remove();

    // The rows group is the accessible tree; each row a treeitem. Its name carries the document
    // identity (the visual header is aria-hidden), and the shared keyboard hint describes the controls.
    const entryFlag = this.doc.isEntry
      ? " (entry document)"
      : this.unreachable
        ? " (unreachable)"
        : "";
    const treeRoot = this.treeG
      .append("g")
      .attr("class", "rows")
      .attr("role", "tree")
      .attr("aria-label", `${headerTitle(this.doc)} · ${docVersionLabel(this.doc)}${entryFlag}`)
      .attr("aria-describedby", "tree-help");

    const rowSel = treeRoot
      .selectAll<SVGGElement, RowDatum>("g.row")
      .data(rows)
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
      .attr("tabindex", (d) => (d.node.data.id === tabbableId ? 0 : -1))
      .classed("selected", (d) => d.node.data.id === this.selectedId)
      .attr("transform", (_d, i) => `translate(0, ${i * ROW_H})`)
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
      .attr("width", colWidth)
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

    // Colored category marker. A reference-pointer row ($ref / operationRef, or a discriminator
    // `mapping` value / Security Requirement key) is drawn in the Structural (reference) color
    // with a shape that reflects how it resolved: an asterisk for a URI-reference, a diamond for
    // a component name. Every other node uses its category color, shaped as a square
    // (object/array/scalar) or a circle. Collapsed nodes read as hollow.
    const isRefField = (d: RowDatum): boolean => {
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
    };
    const refMarker = (d: RowDatum) =>
      resolutionStyles[d.node.data.resolvedAs ?? "uri-reference"].marker;
    const markerClass = (d: RowDatum): string => {
      const parts = ["marker", categoryClass(d.node.data.category)];
      if (d.node._children) parts.push("collapsed");
      return parts.join(" ");
    };
    const markerX = (d: RowDatum): number => d.depth * INDENT + DOT_DX;

    // Reference pointer resolved as a URI-reference: a six-armed asterisk (Structural color).
    rowSel
      .filter((d) => isRefField(d) && refMarker(d) === "asterisk")
      .append("path")
      .attr("class", "marker asterisk cat-structural")
      .attr("d", "M0,-5 L0,5 M-4.33,-2.5 L4.33,2.5 M-4.33,2.5 L4.33,-2.5")
      .attr("transform", (d) => `translate(${markerX(d)}, 0)`);

    // Reference pointer resolved by component name: a filled diamond (Structural color).
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

    const labelEndById = this.labelEndById;
    label.each(function (this: SVGTextElement, d: RowDatum) {
      const sel = select(this);
      sel.append("tspan").attr("class", "k").text(primaryLabel(d.node.data));
      const hidden = d.node._children?.length;
      if (hidden) {
        sel.append("tspan").attr("class", "count").attr("dx", "6").text(`(+${hidden})`);
      }
      const secondary = secondaryLabel(d.node.data);
      if (secondary) {
        sel.append("tspan").attr("class", "t").attr("dx", "8").text(truncate(secondary, 48));
      }
      // Right edge of the rendered label, in the tree group's space (PAD-offset),
      // so right-gutter status markers can sit just past the text.
      const bb = this.getBBox();
      labelEndById.set(d.node.data.id, PAD + bb.x + bb.width);
    });

    this.rowSel = rowSel;

    this.height = this.headerH + PAD + rows.length * ROW_H + PAD;
    this.width = colWidth + PAD;
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
