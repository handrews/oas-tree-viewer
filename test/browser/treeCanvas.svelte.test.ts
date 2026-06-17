import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import TreeCanvas from "../../src/render/TreeCanvas.svelte";
import { resolveOad } from "../../src/refs/resolver";
import { makeDoc, makeOad } from "../helpers";

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
});
