// Renders one document as a collapsible, left-to-right D3 node-link tree inside a
// <g> group. The canvas owns positioning of these groups; this class owns the tree
// itself: layout, collapse/expand state, selection, and reporting its extent.

import { hierarchy, tree, select } from "d3";
import type { HierarchyNode, Selection } from "d3";
import type { OadDocument, TreeNode } from "../types";
import { colorFor } from "./colors";

/** A hierarchy node augmented with layout coords and collapsed-children storage. */
type CNode = HierarchyNode<TreeNode> & {
  x?: number;
  y?: number;
  _children?: CNode[];
  children?: CNode[];
};

const ROW_H = 22; // vertical space per visible node
const COL_W = 220; // horizontal space per depth level
const HEADER_H = 48;
const PAD = 16;
const LABEL_BUDGET = 250; // rough width reserved for the rightmost labels

export interface DocumentViewCallbacks {
  onSelect: (doc: OadDocument, node: TreeNode) => void;
  onLayoutChanged: () => void;
}

export class DocumentView {
  readonly doc: OadDocument;
  readonly group: Selection<SVGGElement, unknown, null, undefined>;
  width = 0;
  height = 0;

  private readonly treeG: Selection<SVGGElement, unknown, null, undefined>;
  private readonly rootHier: CNode;
  private readonly cb: DocumentViewCallbacks;
  private nodeSel: Selection<SVGGElement, CNode, SVGGElement, unknown> | null = null;
  private selectedId: string | null = null;

  constructor(parent: SVGGElement, doc: OadDocument, cb: DocumentViewCallbacks) {
    this.doc = doc;
    this.cb = cb;

    this.group = select(parent).append("g").attr("class", "doc");
    this.renderHeader();

    this.treeG = this.group
      .append("g")
      .attr("class", "tree")
      .attr("transform", `translate(${PAD + 8}, ${HEADER_H + PAD})`);

    this.rootHier = hierarchy<TreeNode>(doc.root) as CNode;
    this.collapseDeep(this.rootHier, 0);
    this.render();
  }

  /** Position this document's group at the given y offset (entry first => y 0). */
  setOffset(y: number): void {
    this.group.attr("transform", `translate(0, ${y})`);
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
    // Collapse every node below the root.
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
    this.nodeSel?.classed("selected", false);
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
    this.nodeSel?.classed("selected", (d) => d.data.id === this.selectedId);
    this.cb.onSelect(this.doc, node);
  }

  private render(): void {
    tree<TreeNode>().nodeSize([ROW_H, COL_W])(this.rootHier);
    const nodes = this.rootHier.descendants() as CNode[];
    const links = this.rootHier.links();

    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    for (const n of nodes) {
      minX = Math.min(minX, n.x ?? 0);
      maxX = Math.max(maxX, n.x ?? 0);
      maxY = Math.max(maxY, n.y ?? 0);
    }
    const offset = -minX; // shift so the topmost node sits at y = 0

    this.treeG.selectAll("*").remove();

    this.treeG
      .append("g")
      .attr("class", "links")
      .selectAll("path")
      .data(links)
      .join("path")
      .attr("class", "link")
      .attr("d", (d) => linkPath(d.source as CNode, d.target as CNode, offset));

    const nodeSel = this.treeG
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, CNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .classed("selected", (d) => d.data.id === this.selectedId)
      .attr("transform", (d) => `translate(${d.y ?? 0}, ${(d.x ?? 0) + offset})`)
      .on("click", (event: MouseEvent, d) => {
        event.stopPropagation();
        this.select(d.data);
      });

    nodeSel
      .append("circle")
      .attr("r", 5.5)
      .attr("class", (d) => (d.data.isReference ? "marker is-ref" : "marker"))
      .attr("fill", (d) => (d._children ? "var(--surface)" : colorFor(d.data.category)))
      .attr("stroke", (d) => colorFor(d.data.category))
      .style("cursor", (d) => (hasChildren(d) ? "pointer" : "default"))
      .on("click", (event: MouseEvent, d) => {
        event.stopPropagation();
        this.toggle(d);
      });

    const label = nodeSel
      .append("text")
      .attr("class", "node-label")
      .attr("dy", "0.32em")
      .attr("x", 10)
      .attr("text-anchor", "start");

    label.each(function (this: SVGTextElement, d: CNode) {
      const sel = select(this);
      sel.append("tspan").attr("class", "k").text(primaryLabel(d.data));
      const secondary = secondaryLabel(d.data);
      if (secondary) {
        sel.append("tspan").attr("class", "t").attr("dx", "7").text(truncate(secondary, 42));
      }
      const hidden = d._children?.length;
      if (hidden) {
        sel.append("tspan").attr("class", "count").attr("dx", "7").text(`(+${hidden})`);
      }
    });

    this.nodeSel = nodeSel;

    this.height = HEADER_H + PAD + (maxX - minX) + PAD;
    this.width = PAD + 8 + maxY + LABEL_BUDGET;
  }

  private renderHeader(): void {
    const h = this.group.append("g").attr("class", "doc-header");
    h.append("rect")
      .attr("class", "doc-header-bg")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", 380)
      .attr("height", HEADER_H - 10)
      .attr("rx", 6);

    h.append("text").attr("class", "doc-title").attr("x", 12).attr("y", 19).text(headerTitle(this.doc));

    const sub =
      `OAS ${this.doc.oasVersion} · ${this.doc.format}` +
      (this.doc.retrievalUri ? ` · ${this.doc.retrievalUri}` : "");
    h.append("text").attr("class", "doc-sub").attr("x", 12).attr("y", 33).text(truncate(sub, 64));

    if (this.doc.isEntry) {
      const badge = h.append("g").attr("class", "entry-badge").attr("transform", "translate(320, 7)");
      badge.append("rect").attr("width", 52).attr("height", 16).attr("rx", 8);
      badge.append("text").attr("x", 26).attr("y", 12).attr("text-anchor", "middle").text("ENTRY");
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

/** A horizontal cubic-bezier link between two laid-out nodes. */
function linkPath(s: CNode, t: CNode, offset: number): string {
  const sx = s.y ?? 0;
  const sy = (s.x ?? 0) + offset;
  const tx = t.y ?? 0;
  const ty = (t.x ?? 0) + offset;
  const mx = (sx + tx) / 2;
  return `M${sx},${sy}C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
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
    return node.keyKind === "root" ? "" : node.oasType ?? "";
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
