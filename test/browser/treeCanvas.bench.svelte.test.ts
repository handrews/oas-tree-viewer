// Render benchmark — NOT part of the gating suite. It skips unless VITE_BENCH is set, so a normal
// `npm test` collects it and immediately skips; run it with `npm run bench`.
//
// It times *rendering only* (the load/parse/classify/resolve/validate pipeline is already off the main
// thread as of v0.7.0): for a sweep of large-but-safe document sizes it constructs the d3 `Canvas` directly,
// times the initial collapsed render and a full "Expand all", and records how many row elements stay
// mounted. Wall-clock numbers are machine-dependent and informational — the stable, machine-independent
// scalability gate (bounded mounted rows) lives in treeCanvas.svelte.test.ts.

import { test, vi } from "vitest";
import { Canvas } from "../../src/render/canvas";
import { makeBigOad, countNodes } from "../bigTree";

const RUN = Boolean(import.meta.env.VITE_BENCH);

// Large enough to be slow on the pre-windowing renderer, small enough that "Expand all" still completes
// (rather than hanging) so a before/after comparison is possible at the same sizes.
const SIZES = [1_000, 3_000, 8_000, 20_000];

// d3-zoom `fit()` transitions (≤300ms) fire after the timed work; let the last one finish before detaching
// the container (a transition on a removed SVG throws "Could not resolve relative length").
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 500));

interface BenchRow {
  target: number;
  nodes: number;
  renderMs: number;
  expandMs: number;
  mountedCollapsed: number;
  mountedExpanded: number;
}

function formatTable(rows: BenchRow[]): string {
  const head = ["target", "nodes", "render ms", "expand ms", "rows@collapsed", "rows@expanded"];
  const cells = rows.map((r) => [
    String(r.target),
    String(r.nodes),
    r.renderMs.toFixed(1),
    r.expandMs.toFixed(1),
    String(r.mountedCollapsed),
    String(r.mountedExpanded),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));
  const line = (cols: string[]): string => cols.map((c, i) => c.padStart(widths[i]!)).join("  ");
  return ["", "Tree render benchmark (rendering only):", line(head), ...cells.map(line)].join("\n");
}

test.runIf(RUN)(
  "render benchmark sweep",
  async () => {
    const rows: BenchRow[] = [];
    for (const target of SIZES) {
      const oad = await makeBigOad(target);
      const nodes = countNodes(oad.documents[0]!.root);

      const container = document.createElement("div");
      document.body.appendChild(container);
      const canvas = new Canvas(container, { onSelect: () => {}, onBackground: () => {} });

      const r0 = performance.now();
      canvas.render(oad); // synchronous: builds every DocumentView's collapsed tree
      const renderMs = performance.now() - r0;
      const mountedCollapsed = container.querySelectorAll("g.row").length;

      // "Expand all" via the toolbar, the real code path. Pre-windowing it confirms past MAX_RENDER_ROWS,
      // so accept the prompt; the prompt is instant and not part of the measured synchronous expand work.
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      const expandBtn = container.querySelector<HTMLButtonElement>('[data-act="expand"]')!;
      const e0 = performance.now();
      expandBtn.click();
      const expandMs = performance.now() - e0;
      const mountedExpanded = container.querySelectorAll("g.row").length;
      confirmSpy.mockRestore();

      rows.push({ target, nodes, renderMs, expandMs, mountedCollapsed, mountedExpanded });
      await settle();
      container.remove();
    }
    // Surfaced under "stdout |" by the verbose reporter (the `bench` script sets it); the default
    // reporter stays quiet for passing tests, so `npm run bench` pins `--reporter=verbose`.
    console.log(formatTable(rows));
  },
  180_000,
);
