import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import TreeCanvas from "../../src/render/TreeCanvas.svelte";
import { resolveOad } from "../../src/refs/resolver";
import { makeDoc, makeOad } from "../helpers";

/** A valid OpenAPI doc with `schemas` schemas each carrying `props` string properties — enough nodes to
 *  cross the Expand-all render threshold (MAX_RENDER_ROWS = 5000) while still rendering small collapsed. */
function bigOad(schemas: number, props: number): string {
  const sch: Record<string, unknown> = {};
  for (let s = 0; s < schemas; s++) {
    const properties: Record<string, unknown> = {};
    for (let p = 0; p < props; p++) properties[`p${p}`] = { type: "string" };
    sch[`S${s}`] = { type: "object", properties };
  }
  return JSON.stringify({
    openapi: "3.1.0",
    info: { title: "T", version: "1" },
    paths: {},
    components: { schemas: sch },
  });
}

const DOC = `
openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200': { description: ok }
components:
  schemas:
    Pet: { type: object }
`;

// `fit()` runs a 300ms d3-zoom transition; let it complete before the test ends so it doesn't fire on
// the SVG after vitest-browser-svelte unmounts it (a detached SVG can't resolve its `100%` extent).
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 400));

// Exercises the d3 island through its Svelte wrapper in a real browser — the canvas
// needs genuine layout (getBBox/fit), which only browser mode provides.
test("TreeCanvas renders the d3 island (one g.doc per document)", async () => {
  const oad = makeOad(await makeDoc(DOC, { isEntry: true }));
  const refs = resolveOad(oad);

  render(TreeCanvas, {
    oad,
    refs,
    onselect: () => {},
    onbackground: () => {},
  });

  await expect.poll(() => document.querySelectorAll("svg.tree-canvas g.doc").length).toBe(1);
  expect(document.querySelectorAll("svg.tree-canvas g.row").length).toBeGreaterThan(0);
  await settle();
});

test("Expand all confirms before rendering a very large tree, and aborts when declined", async () => {
  const oad = makeOad(await makeDoc(bigOad(60, 50), { isEntry: true })); // ~6k nodes, over the threshold
  const refs = resolveOad(oad);
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

  render(TreeCanvas, { oad, refs, onselect: () => {}, onbackground: () => {} });
  await expect.poll(() => document.querySelectorAll("svg.tree-canvas g.doc").length).toBe(1);
  const before = document.querySelectorAll("g.row").length;

  (document.querySelector('[data-act="expand"]') as HTMLButtonElement).click();

  expect(confirmSpy).toHaveBeenCalledOnce();
  expect(confirmSpy.mock.calls[0]![0]).toMatch(/render [\d,]+ rows .*unresponsive/i);
  // Declining leaves the tree collapsed (no bulk render).
  expect(document.querySelectorAll("g.row").length).toBe(before);
  confirmSpy.mockRestore();
  await settle();
});

test("Expand all does not confirm for a normally-sized tree, and expands it", async () => {
  const oad = makeOad(await makeDoc(DOC, { isEntry: true }));
  const refs = resolveOad(oad);
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

  render(TreeCanvas, { oad, refs, onselect: () => {}, onbackground: () => {} });
  await expect.poll(() => document.querySelectorAll("svg.tree-canvas g.doc").length).toBe(1);
  const before = document.querySelectorAll("g.row").length;

  (document.querySelector('[data-act="expand"]') as HTMLButtonElement).click();

  expect(confirmSpy).not.toHaveBeenCalled();
  await expect.poll(() => document.querySelectorAll("g.row").length).toBeGreaterThan(before);
  confirmSpy.mockRestore();
  await settle();
});
