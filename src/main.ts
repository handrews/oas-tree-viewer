// Application bootstrap: wires the input form to the loader/assembler, resolves
// references, and feeds the OAD + resolved references to the canvas and detail panel.

import "./styles.css";
import type { Oad, OadDocument } from "./types";
import type { ResolvedRefs } from "./refs/types";
import { loadDocument } from "./loader";
import { assembleOad } from "./oad";
import { resolveOad } from "./refs/resolver";
import { errorMessage } from "./errors";
import { OadForm } from "./ui/oadForm";
import { setupTheme } from "./ui/theme";
import { Canvas } from "./render/canvas";
import type { DetailContext } from "./render/detailPanel";
import { renderLegend, renderDetail, clearDetail } from "./render/detailPanel";

setupTheme(document.querySelector<HTMLElement>("#app-header")!);

const inputPanel = document.querySelector<HTMLElement>("#input-panel")!;
const viewer = document.querySelector<HTMLElement>("#viewer")!;
const canvasWrap = document.querySelector<HTMLElement>("#canvas-wrap")!;
const detailPanel = document.querySelector<HTMLElement>("#detail-panel")!;

let canvas: Canvas | null = null;
let detailCtx: DetailContext | null = null;

function ensureCanvas(): Canvas {
  if (!canvas) {
    canvas = new Canvas(canvasWrap, {
      onSelect: (doc, node) => renderDetail(detailPanel, doc, node, detailCtx ?? undefined),
      onBackground: () => clearDetail(detailPanel),
    });
  }
  return canvas;
}

function showViewer(oad: Oad, refs: ResolvedRefs): void {
  viewer.hidden = false;
  renderLegend(detailPanel);

  const c = ensureCanvas();
  const docsById = new Map(oad.documents.map((d) => [d.id, d]));
  detailCtx = {
    refs,
    docLabel: (id) => docLabel(docsById.get(id), id),
    onNavigate: (docId, nodeId) => c.navigateTo(docId, nodeId),
  };

  c.render(oad);
  c.setReferences(refs);
  viewer.scrollIntoView({ behavior: "smooth", block: "start" });
}

function docLabel(doc: OadDocument | undefined, fallback: string): string {
  if (!doc) return fallback;
  return doc.filename ?? doc.retrievalUri ?? `(${doc.source} document)`;
}

new OadForm(inputPanel, {
  onRender: async (inputs) => {
    const docs: OadDocument[] = [];
    const rowErrors: Record<number, string> = {};

    for (let i = 0; i < inputs.length; i++) {
      try {
        docs.push(await loadDocument(inputs[i]!));
      } catch (e) {
        rowErrors[i] = errorMessage(e);
      }
    }
    if (Object.keys(rowErrors).length > 0) return { ok: false, rowErrors };

    try {
      const oad = assembleOad(docs);
      const refs = resolveOad(oad);
      showViewer(oad, refs);
      return { ok: true };
    } catch (e) {
      return { ok: false, oadError: errorMessage(e) };
    }
  },
});
