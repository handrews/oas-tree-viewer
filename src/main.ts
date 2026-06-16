// Application bootstrap: wires the input form to the loader/assembler and the
// resulting OAD to the tree canvas and detail panel.

import "./styles.css";
import type { Oad, OadDocument } from "./types";
import { loadDocument } from "./loader";
import { assembleOad } from "./oad";
import { errorMessage } from "./errors";
import { OadForm } from "./ui/oadForm";
import { Canvas } from "./render/canvas";
import { renderLegend, renderDetail, clearDetail } from "./render/detailPanel";

const inputPanel = document.querySelector<HTMLElement>("#input-panel")!;
const viewer = document.querySelector<HTMLElement>("#viewer")!;
const canvasWrap = document.querySelector<HTMLElement>("#canvas-wrap")!;
const detailPanel = document.querySelector<HTMLElement>("#detail-panel")!;

let canvas: Canvas | null = null;

function ensureCanvas(): Canvas {
  if (!canvas) {
    canvas = new Canvas(canvasWrap, {
      onSelect: (doc, node) => renderDetail(detailPanel, doc, node),
      onBackground: () => clearDetail(detailPanel),
    });
  }
  return canvas;
}

function showViewer(oad: Oad): void {
  viewer.hidden = false;
  renderLegend(detailPanel);
  ensureCanvas().render(oad);
  viewer.scrollIntoView({ behavior: "smooth", block: "start" });
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
      showViewer(oad);
      return { ok: true };
    } catch (e) {
      return { ok: false, oadError: errorMessage(e) };
    }
  },
});
