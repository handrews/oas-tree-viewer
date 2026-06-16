// Renders the side panel: details for the currently selected node, plus a legend
// mapping colors to node categories.

import type { OadDocument, TreeNode } from "../types";
import type { ReferenceEdge, ResolvedRefs } from "../refs/types";
import { refKey } from "../refs/types";
import { displayPointer } from "../model/jsonPointer";
import { descendantCount } from "../model/treeBuilder";
import { categoryColor, categoryLabel, legendOrder } from "./colors";

export interface DetailContext {
  refs: ResolvedRefs;
  docLabel: (docId: string) => string;
  onNavigate: (docId: string, nodeId: string) => void;
}

export function renderLegend(container: HTMLElement): void {
  const items = legendOrder
    .map(
      (cat) =>
        `<li><span class="swatch" style="background:${categoryColor[cat]}"></span>${escapeHtml(
          categoryLabel[cat],
        )}</li>`,
    )
    .join("");
  container.innerHTML = `
    <section class="legend">
      <h3>Legend</h3>
      <ul class="legend-list">${items}</ul>
    </section>
    <section class="node-detail empty">
      <p class="hint">Click a node's label to inspect it. Click a node's dot to expand or collapse.</p>
    </section>
  `;
}

export function renderDetail(
  container: HTMLElement,
  doc: OadDocument,
  node: TreeNode,
  ctx?: DetailContext,
): void {
  const detail = container.querySelector(".node-detail");
  if (!detail) return;

  const rows: string[] = [];
  rows.push(row("Document", documentLabel(doc)));
  rows.push(row("Pointer", `<code>${escapeHtml(displayPointer(node.id))}</code>`));
  rows.push(row("OAS type", node.oasType ? escapeHtml(node.oasType) : "<em>generic</em>"));
  rows.push(row("Value kind", escapeHtml(node.valueKind)));

  if (node.valueKind === "object" || node.valueKind === "array") {
    rows.push(
      row(
        "Children",
        `${node.children.length} direct · ${descendantCount(node)} total`,
      ),
    );
  } else {
    rows.push(row("Value", `<code>${escapeHtml(formatScalar(node.scalarValue))}</code>`));
  }

  const baseUri = doc.selfUri ?? doc.retrievalUri;
  if (baseUri) {
    rows.push(row("Base URI", `<code>${escapeHtml(baseUri)}</code>${doc.selfUri ? " ($self)" : ""}`));
  }

  let refsHtml = "";
  if (ctx) refsHtml = renderRefSections(ctx, doc.id, node.id);

  detail.classList.remove("empty");
  detail.innerHTML = `<h3>Selected node</h3><dl class="detail-grid">${rows.join("")}</dl>${refsHtml}`;

  if (ctx) wireNavLinks(detail, ctx.onNavigate);
}

export function clearDetail(container: HTMLElement): void {
  const detail = container.querySelector(".node-detail");
  if (!detail) return;
  detail.classList.add("empty");
  detail.innerHTML = `<p class="hint">Click a node's label to inspect it. Click a node's dot to expand or collapse.</p>`;
}

// ── helpers ────────────────────────────────────────────────────────────────

function documentLabel(doc: OadDocument): string {
  const name = doc.filename ?? doc.retrievalUri ?? `(${doc.source} document)`;
  const tag = doc.isEntry ? ' <span class="pill">entry</span>' : "";
  return `${escapeHtml(name)} <span class="dim">· OAS ${escapeHtml(doc.oasVersion)}</span>${tag}`;
}

function row(label: string, valueHtml: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd>`;
}

function renderRefSections(ctx: DetailContext, docId: string, nodeId: string): string {
  const key = refKey(docId, nodeId);
  const outgoing = dedupe(ctx.refs.bySource.get(key) ?? []);
  const incoming = dedupe(ctx.refs.byTarget.get(key) ?? []);

  let html = "";
  if (outgoing.length) {
    html += `<div class="ref-section"><h4>Resolves to →</h4>${outgoing
      .map((e) => outgoingItem(e, ctx))
      .join("")}</div>`;
  }
  if (incoming.length) {
    html += `<div class="ref-section"><h4>Referenced by ←</h4>${incoming
      .map((e) => incomingItem(e, ctx))
      .join("")}</div>`;
  }
  return html;
}

function outgoingItem(e: ReferenceEdge, ctx: DetailContext): string {
  const badge = statusBadge(e.status);
  if (e.targetDocId && e.targetNodeId) {
    const label = `${escapeHtml(ctx.docLabel(e.targetDocId))} <code>${escapeHtml(
      displayPointer(e.targetNodeId),
    )}</code>`;
    const note =
      e.status === "type-mismatch"
        ? `<div class="ref-note">expected <strong>${escapeHtml(e.requiredType)}</strong>, found <strong>${escapeHtml(e.targetType ?? "?")}</strong></div>`
        : "";
    return `<div class="ref-item">${badge}<a class="nav-ref" data-nav-doc="${escapeHtml(e.targetDocId)}" data-nav-node="${escapeHtml(e.targetNodeId)}">${label}</a>${note}</div>`;
  }
  return `<div class="ref-item">${badge}<code>${escapeHtml(e.refString)}</code><div class="ref-note">${e.status === "external" ? "target document not loaded" : "fragment not found"}</div></div>`;
}

function incomingItem(e: ReferenceEdge, ctx: DetailContext): string {
  const label = `${escapeHtml(ctx.docLabel(e.sourceDocId))} <code>${escapeHtml(
    displayPointer(e.sourceObjectId),
  )}</code>`;
  return `<div class="ref-item">${statusBadge(e.status)}<a class="nav-ref" data-nav-doc="${escapeHtml(e.sourceDocId)}" data-nav-node="${escapeHtml(e.sourceObjectId)}">${label}</a></div>`;
}

function statusBadge(status: string): string {
  return `<span class="ref-badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function dedupe(edges: ReferenceEdge[]): ReferenceEdge[] {
  const seen = new Map<string, ReferenceEdge>();
  for (const e of edges) seen.set(e.id, e);
  return [...seen.values()];
}

function wireNavLinks(
  detail: Element,
  onNavigate: (docId: string, nodeId: string) => void,
): void {
  detail.querySelectorAll<HTMLElement>(".nav-ref").forEach((el) => {
    el.addEventListener("click", () => {
      const docId = el.getAttribute("data-nav-doc");
      const nodeId = el.getAttribute("data-nav-node");
      if (docId !== null && nodeId !== null) onNavigate(docId, nodeId);
    });
  });
}

function formatScalar(value: string | number | boolean | null | undefined): string {
  if (typeof value === "string") return value;
  return String(value);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
