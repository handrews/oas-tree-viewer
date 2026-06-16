// Renders the side panel: details for the currently selected node, plus a legend
// mapping colors to node categories.

import type { OadDocument, TreeNode } from "../types";
import { displayPointer } from "../model/jsonPointer";
import { descendantCount } from "../model/treeBuilder";
import { categoryColor, categoryLabel, legendOrder } from "./colors";

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

export function renderDetail(container: HTMLElement, doc: OadDocument, node: TreeNode): void {
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

  if (node.isReference && node.refTarget) {
    rows.push(row("Reference", `<code>${escapeHtml(node.refTarget)}</code>`));
  }

  const baseUri = doc.selfUri ?? doc.retrievalUri;
  if (baseUri) {
    rows.push(row("Base URI", `<code>${escapeHtml(baseUri)}</code>${doc.selfUri ? " ($self)" : ""}`));
  }

  detail.classList.remove("empty");
  detail.innerHTML = `<h3>Selected node</h3><dl class="detail-grid">${rows.join("")}</dl>`;
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
