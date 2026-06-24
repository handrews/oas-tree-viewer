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

// `fit()`/`recenter()` run d3-zoom transitions (≤400ms); let the last one finish before the test ends so
// it doesn't fire on the SVG after vitest-browser-svelte unmounts it (a detached SVG can't resolve its
// `100%` extent — d3-zoom throws "Could not resolve relative length").
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 450));

const treeitems = (): SVGGElement[] => [
  ...document.querySelectorAll<SVGGElement>('g.row[role="treeitem"]'),
];
const key = (el: Element, k: string): void =>
  void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

function renderDoc(onselect: (doc: unknown, node: unknown) => void = () => {}): Promise<void> {
  return makeDoc(DOC, { isEntry: true }).then((doc) => {
    const oad = makeOad(doc);
    render(TreeCanvas, { oad, refs: resolveOad(oad), onselect, onbackground: () => {} });
  });
}

// Exercises the d3 island through its Svelte wrapper in a real browser — the canvas
// needs genuine layout (getBBox/fit), which only browser mode provides.
test("TreeCanvas renders the d3 island (one g.doc per document)", async () => {
  await renderDoc();
  await expect.poll(() => document.querySelectorAll("svg.tree-canvas g.doc").length).toBe(1);
  expect(document.querySelectorAll("svg.tree-canvas g.row").length).toBeGreaterThan(0);
  await settle();
});

test("exposes an accessible tree: role=tree with a label + describedby, treeitems with ARIA state", async () => {
  await renderDoc();
  await expect.poll(() => document.querySelector('[role="tree"]')).not.toBeNull();

  const tree = document.querySelector('[role="tree"]')!;
  expect(tree.getAttribute("aria-label")).toMatch(/OAS 3\.1.*entry document/i);
  expect(tree.getAttribute("aria-describedby")).toBe("tree-help");
  expect(document.getElementById("tree-help")?.textContent).toMatch(/arrow keys/i);

  const items = treeitems();
  expect(items.length).toBeGreaterThan(0);
  // The root is level 1 and expanded; every treeitem has an accessible name.
  expect(items[0]!.getAttribute("aria-level")).toBe("1");
  expect(items[0]!.getAttribute("aria-expanded")).toBe("true");
  for (const it of items) expect(it.getAttribute("aria-label")).toBeTruthy();
  // Exactly one row is in the tab order (roving tabindex).
  expect(items.filter((it) => it.getAttribute("tabindex") === "0")).toHaveLength(1);
  // A leaf omits aria-expanded; a collapsed branch reports it false.
  expect(items.some((it) => it.getAttribute("aria-expanded") === "false")).toBe(true);
  await settle();
});

test("arrow keys move focus; Right/Left expand and collapse; Enter selects", async () => {
  const onselect = vi.fn();
  await renderDoc(onselect);
  await expect.poll(() => document.querySelector('[role="tree"]')).not.toBeNull();

  // Down moves the roving focus to the next visible row.
  const root = treeitems()[0]!;
  root.focus();
  expect(document.activeElement).toBe(root);
  // The focused row engages :focus (which the focus-ring CSS keys off); the ring's computed stroke is
  // asserted in the e2e, since global styles.css isn't loaded in the isolated component test.
  expect(root.matches(":focus")).toBe(true);
  key(root, "ArrowDown");
  const second = treeitems()[1]!;
  expect(document.activeElement).toBe(second);
  expect(second.getAttribute("tabindex")).toBe("0");
  expect(root.getAttribute("tabindex")).toBe("-1");

  // Right expands a collapsed branch (focus stays on it); the rows are rebuilt, so re-read from focus.
  const collapsed = treeitems().find((it) => it.getAttribute("aria-expanded") === "false")!;
  const before = treeitems().length;
  collapsed.focus();
  key(collapsed, "ArrowRight");
  const expanded = document.activeElement as SVGGElement;
  expect(expanded.getAttribute("aria-expanded")).toBe("true");
  expect(treeitems().length).toBeGreaterThan(before);

  // Left collapses it again.
  key(expanded, "ArrowLeft");
  expect(treeitems().length).toBe(before);

  // Enter selects the focused node (the only thing that selects, per the explicit-selection model).
  const target = treeitems()[1]!;
  target.focus();
  key(target, "Enter");
  expect(onselect).toHaveBeenCalledTimes(1);
  expect(treeitems()[1]!.getAttribute("aria-selected")).toBe("true");
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
