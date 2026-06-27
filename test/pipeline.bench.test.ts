// Pipeline benchmark — NOT part of the gating suite. Like the render bench it skips unless VITE_BENCH
// is set, so a normal `npm test` collects it and immediately skips; run it with `npm run bench`.
//
// It times the two *worker-side* pipeline stages this release added — the source-position pass
// (parse/positions.ts) and the unified diagnostics build (diagnostics/runner.ts) — against two
// reference points already present before the change: the raw parse the pipeline always paid, and the
// full single-document finalize. Both new stages run off the main thread, so the render bench can't
// see them; this is where their cost shows up. The before/after is structural rather than a re-run of
// deleted code (the measured functions ARE the new code): the position pass is pure added work, so the
// pipeline *without* it is ≈ `pipeline − positions`; the diagnostics build replaced scattered
// main-thread work in collectIssues with one worker-side walk, and its absolute cost is reported here.
//
// The synthetic document is reference-free, which stresses the diagnostics runner's dominant term — the
// full-tree node walk that scales with node count — rather than the per-edge term (few edges in real
// documents). Wall-clock numbers are machine-dependent and informational; the value is the relative
// size of the added stages and a committed guard against a future regression in them.

import { test } from "vitest";
import { parseDocument } from "../src/parse/detectFormat";
import { documentPositions } from "../src/parse/positions";
import { buildDiagnostics } from "../src/diagnostics/runner";
import { resolveOad } from "../src/refs/resolver";
import { reachableDocIds } from "../src/refs/reachability";
import { analyzeDynamicScope } from "../src/refs/dynamicScope";
import type { AnchorRef } from "../src/refs/dynamicScope";
import type { TreeNode } from "../src/types";
import { bigOadText, bigRefOadText, dimsFor, countNodes } from "./bigTree";
import { makeDoc, makeOad } from "./helpers";

const RUN = Boolean(process.env.VITE_BENCH ?? import.meta.env.VITE_BENCH);

// Same sweep as the render bench, so the two tables line up at matching node counts.
const SIZES = [1_000, 3_000, 8_000, 20_000];
const BRANCHING = 24;
// Micro-stages are fast and deterministic; take the min of a few runs to shed GC/scheduler noise.
const REPS = 5;

interface BenchRow {
  target: number;
  nodes: number;
  pointers: number;
  parseMs: number;
  positionsMs: number;
  diagMs: number;
  diagCount: number;
  pipelineMs: number;
}

/** Minimum wall-clock of `reps` runs of a synchronous stage (least perturbed by GC). */
function bestOf(fn: () => void, reps: number): number {
  let best = Infinity;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

function formatTable(rows: BenchRow[]): string {
  const head = [
    "target",
    "nodes",
    "pointers",
    "parse ms",
    "positions ms",
    "diag ms",
    "diags",
    "pipeline ms",
    "pos %pipe",
  ];
  const cells = rows.map((r) => [
    String(r.target),
    String(r.nodes),
    String(r.pointers),
    r.parseMs.toFixed(1),
    r.positionsMs.toFixed(1),
    r.diagMs.toFixed(1),
    String(r.diagCount),
    r.pipelineMs.toFixed(1),
    `${((r.positionsMs / r.pipelineMs) * 100).toFixed(0)}%`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)));
  const line = (cols: string[]): string => cols.map((c, i) => c.padStart(widths[i]!)).join("  ");
  return [
    "",
    "Pipeline benchmark (worker-side stages added this release; min of runs, informational):",
    "  positions = Phase 2 source-position pass · diag = Phase 1 diagnostics build",
    "  pipeline = full single-doc finalize WITH positions; pipeline without ≈ pipeline − positions",
    line(head),
    ...cells.map(line),
  ].join("\n");
}

test.runIf(RUN)(
  "pipeline stage benchmark sweep",
  async () => {
    const rows: BenchRow[] = [];
    for (const target of SIZES) {
      const { schemas, branching } = dimsFor(target, BRANCHING);
      const text = bigOadText(schemas, branching);

      // The pre-existing baseline: the parse the pipeline always ran (before either phase).
      const parseMs = bestOf(() => void parseDocument(text, "big.json"), REPS);
      // Phase 2: the added source-position pass over the same raw text.
      const positionsMs = bestOf(() => void documentPositions(text), REPS);
      const pointers = documentPositions(text).size;

      // The full single-document pipeline (detect + finalize), which now includes the position pass.
      const p0 = performance.now();
      const doc = await makeDoc(text, { isEntry: true });
      const pipelineMs = performance.now() - p0;
      const nodes = countNodes(doc.root);

      // Phase 1: the diagnostics build, over the resolved OAD — same inputs bootstrap.ts feeds it.
      const oad = makeOad(doc);
      const refs = resolveOad(oad);
      const reachable = reachableDocIds(oad, refs.edges);
      const unreachable = oad.documents.filter((d) => !reachable.has(d.id));
      const diagMs = bestOf(() => void buildDiagnostics(oad, refs, unreachable), REPS);
      const diagCount = buildDiagnostics(oad, refs, unreachable).length;

      rows.push({
        target,
        nodes,
        pointers,
        parseMs,
        positionsMs,
        diagMs,
        diagCount,
        pipelineMs,
      });
    }
    // Surfaced under "stdout |" by the verbose reporter the `bench` script pins; the default reporter
    // stays quiet for passing tests.
    console.log(formatTable(rows));
  },
  180_000,
);

// Reference resolution is the core path the sweep above can't see (its document is reference-free). This
// stresses it two ways: `resolveOad` over a reference-heavy document (≈ schemas × branching edges), and the
// `$dynamicRef` scope analyzer driven directly over a synthetic resource graph with many same-named anchors
// (the O(resources) reverse-reachability fixpoint that only `$dynamicRef` documents reach).
test.runIf(RUN)(
  "resolution + dynamic-scope benchmark sweep",
  async () => {
    const REF_BRANCHING = 8;
    const resRows: { schemas: number; edges: number; resolveMs: number }[] = [];
    for (const targetEdges of [200, 600, 1_500]) {
      const schemas = Math.max(2, Math.round(targetEdges / REF_BRANCHING));
      const oad = makeOad(await makeDoc(bigRefOadText(schemas, REF_BRANCHING), { isEntry: true }));
      const edges = resolveOad(oad).edges.length;
      const resolveMs = bestOf(() => void resolveOad(oad), REPS);
      resRows.push({ schemas, edges, resolveMs });
    }

    // Synthetic dynamic-scope input: a chain ER → R0 → … → R(n-1), every resource declaring the same
    // `$dynamicAnchor` and holding a `$dynamicRef` — the worst case for the eligibility/reachability passes.
    const stubNode = (id: string): TreeNode => ({
      id,
      key: null,
      keyKind: "root",
      valueKind: "object",
      children: [],
    });
    // Small sizes by design: every resource shares one anchor name, the analyzer's worst case (a dense
    // same-named fan-out, ~O(n²) dynamic edges), so this surfaces that growth without the run itself
    // blowing up.
    const dynRows: { resources: number; buildMs: number; queryAllMs: number }[] = [];
    for (const n of [50, 150, 400]) {
      const resourceEdges = [{ from: "ER", to: "R0" }];
      const anchors: AnchorRef[] = [];
      for (let i = 0; i < n; i++) {
        if (i > 0) resourceEdges.push({ from: `R${i - 1}`, to: `R${i}` });
        anchors.push({ resourceUri: `R${i}`, docId: "d", node: stubNode(`R${i}#a`) });
      }
      const params = {
        entryRoot: "ER",
        resourceEdges,
        dynamicRefs: anchors.map((a) => ({ resourceUri: a.resourceUri, name: "item" })),
        anchorsByName: new Map([["item", anchors]]),
      };
      const buildMs = bestOf(() => void analyzeDynamicScope(params), REPS);
      const queryAllMs = bestOf(() => {
        const a = analyzeDynamicScope(params);
        for (let i = 0; i < n; i++) a.winners(`R${i}`, "item");
      }, REPS);
      dynRows.push({ resources: n, buildMs, queryAllMs });
    }

    const res = [
      "",
      "Resolution benchmark (resolveOad over a reference-heavy document; min of runs, informational):",
      "  schemas  edges  resolve ms",
      ...resRows.map(
        (r) =>
          `  ${String(r.schemas).padStart(7)}  ${String(r.edges).padStart(5)}  ${r.resolveMs.toFixed(1).padStart(10)}`,
      ),
      "",
      "Dynamic-scope benchmark (analyzeDynamicScope over a same-named-anchor chain):",
      "  resources  build ms  query-all ms",
      ...dynRows.map(
        (r) =>
          `  ${String(r.resources).padStart(9)}  ${r.buildMs.toFixed(1).padStart(8)}  ${r.queryAllMs.toFixed(1).padStart(12)}`,
      ),
    ].join("\n");
    console.log(res);
  },
  180_000,
);
