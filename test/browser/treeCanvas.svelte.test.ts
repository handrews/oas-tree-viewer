import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import TreeCanvas from "../../src/render/TreeCanvas.svelte";
import { resolveOad } from "../../src/refs/resolver";
import { makeDoc, makeOad } from "../helpers";
import { makeBigOad } from "../bigTree";

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

test("windows a very large tree: Expand all mounts only a viewport-worth of rows, with no prompt", async () => {
  const oad = await makeBigOad(6000); // well above VIRTUALIZE_ABOVE (2000)
  const refs = resolveOad(oad);
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

  render(TreeCanvas, { oad, refs, onselect: () => {}, onbackground: () => {} });
  await expect.poll(() => document.querySelectorAll("svg.tree-canvas g.doc").length).toBe(1);

  (document.querySelector('[data-act="expand"]') as HTMLButtonElement).click();

  // No confirmation (windowing removed the freeze), and only a bounded slice of the thousands of rows is
  // mounted even though every node is now "expanded".
  expect(confirmSpy).not.toHaveBeenCalled();
  const mounted = treeitems().length;
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(200);
  confirmSpy.mockRestore();
  await settle();
});

test("focus-follows-window: keyboard nav to an off-window row mounts and focuses it", async () => {
  const oad = await makeBigOad(6000);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(TreeCanvas, { oad, refs: resolveOad(oad), onselect: () => {}, onbackground: () => {} });
  await expect.poll(() => document.querySelector('[role="tree"]')).not.toBeNull();

  (document.querySelector('[data-act="expand"]') as HTMLButtonElement).click();
  const root = treeitems()[0]!;
  root.focus();
  key(root, "End"); // jump to the last row — far outside the mounted window

  // The focused element is a real, mounted treeitem (force-included) holding the roving tab stop.
  const active = document.activeElement as SVGGElement;
  expect(active.getAttribute("role")).toBe("treeitem");
  expect(active.getAttribute("tabindex")).toBe("0");
  expect(active.getAttribute("aria-label")).toBeTruthy();
  vi.restoreAllMocks();
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
