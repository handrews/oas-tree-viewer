// Synthetic large-OAD builder for render benchmarks and large-tree scalability tests. It runs the real
// pipeline (parse → validate → buildTree → classify → assemble), so the renderer is exercised on a
// genuinely classified tree of a chosen size rather than a hand-built fixture.

import type { Oad, TreeNode } from "../src/types";
import { makeDoc, makeOad } from "./helpers";

/**
 * An OpenAPI 3.1 document whose `components.schemas` holds `schemas` object schemas, each with `branching`
 * string properties. Tree-node count ≈ `schemas × (2·branching + 3)` plus a small fixed envelope (each
 * property contributes its own node plus its `type` scalar; each schema adds its node, `properties`, and
 * `type: object`).
 */
export function bigOadText(schemas: number, branching: number): string {
  const sch: Record<string, unknown> = {};
  for (let s = 0; s < schemas; s++) {
    const properties: Record<string, unknown> = {};
    for (let p = 0; p < branching; p++) properties[`p${p}`] = { type: "string" };
    sch[`S${s}`] = { type: "object", properties };
  }
  return JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Big", version: "1" },
    paths: {},
    components: { schemas: sch },
  });
}

/**
 * A reference-heavy OAS 3.1 document: `schemas` component schemas, each with `branching` properties that
 * are `$ref`s to other component schemas (a rotating fan-out). Produces ≈ `schemas × branching` reference
 * edges — the work that stresses `resolveOad`, which the reference-free {@link bigOadText} never exercises.
 */
export function bigRefOadText(schemas: number, branching: number): string {
  const sch: Record<string, unknown> = {};
  for (let s = 0; s < schemas; s++) {
    const properties: Record<string, unknown> = {};
    for (let p = 0; p < branching; p++) {
      const target = (s + p + 1) % schemas; // each property points at a different schema
      properties[`p${p}`] = { $ref: `#/components/schemas/S${target}` };
    }
    sch[`S${s}`] = { type: "object", properties };
  }
  return JSON.stringify({
    openapi: "3.1.0",
    info: { title: "BigRef", version: "1" },
    paths: {},
    components: { schemas: sch },
  });
}

/** Pick a (schemas, branching) pair landing near `targetNodes`, keeping a moderate branching factor so the
 *  tree has realistic depth rather than one giant fan-out. */
export function dimsFor(
  targetNodes: number,
  branching: number,
): { schemas: number; branching: number } {
  const perSchema = 2 * branching + 3;
  return { schemas: Math.max(1, Math.round(targetNodes / perSchema)), branching };
}

/** Build a real Oad of approximately `targetNodes` tree nodes for benchmarks / large-tree tests. */
export function makeBigOad(targetNodes: number, branching = 24): Promise<Oad> {
  const { schemas, branching: b } = dimsFor(targetNodes, branching);
  return makeDoc(bigOadText(schemas, b), { isEntry: true }).then((doc) => makeOad(doc));
}

/** Total tree nodes under `root` (every key and array element) — the count a full "Expand all" reveals. */
export function countNodes(root: TreeNode): number {
  let n = 0;
  const visit = (node: TreeNode): void => {
    n += 1;
    for (const child of node.children) visit(child);
  };
  visit(root);
  return n;
}
