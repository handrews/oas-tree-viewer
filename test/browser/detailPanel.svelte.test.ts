import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import DetailPanel from "../../src/render/DetailPanel.svelte";
import { resolveOad } from "../../src/refs/resolver";
import type { OadDocument, TreeNode } from "../../src/types";
import type { DetailContext } from "../../src/render/detail";
import { makeDoc, makeOad } from "../helpers";

const DOC = `
openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /a:
    get:
      operationId: op
      parameters:
        - $ref: '#/components/schemas/S'
        - $ref: https://other.example/x.yaml#/components/parameters/P
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/S' }
components:
  schemas:
    S: { type: object }
`;

function at(root: TreeNode, pointer: string): TreeNode {
  const find = (n: TreeNode): TreeNode | undefined => {
    if (n.id === pointer) return n;
    for (const c of n.children) {
      const r = find(c);
      if (r) return r;
    }
    return undefined;
  };
  return find(root)!;
}

function ctxFor(doc: OadDocument): DetailContext & { onNavigate: ReturnType<typeof vi.fn> } {
  const onNavigate = vi.fn<(docId: string, nodeId: string) => void>();
  return { refs: resolveOad(makeOad(doc)), docLabel: () => "doc.yaml", onNavigate };
}

test("shows an empty hint when nothing is selected", async () => {
  const screen = render(DetailPanel, { selected: null, ctx: null });
  await expect.element(screen.getByText(/Click a node/)).toBeVisible();
});

test("shows selected node info, incoming refs, and wires navigation", async () => {
  const doc = await makeDoc(DOC, { isEntry: true });
  const ctx = ctxFor(doc);
  const screen = render(DetailPanel, {
    selected: { doc, node: at(doc.root, "/components/schemas/S") },
    ctx,
  });

  await expect.element(screen.getByText("Selected node")).toBeVisible();
  await expect.element(screen.getByText("Schema Object")).toBeVisible();
  await expect.element(screen.getByText(/Referenced by/)).toBeVisible();

  // The two incoming edges carry resolved + type-mismatch badges.
  await expect
    .poll(() => [...document.querySelectorAll(".ref-item .ref-badge")].map((b) => b.textContent).sort())
    .toEqual(["resolved", "type-mismatch"]);

  // Clicking a nav link navigates.
  (document.querySelector(".nav-ref") as HTMLButtonElement).click();
  expect(ctx.onNavigate).toHaveBeenCalled();
});

const OPS_DOC = `
openapi: 3.2.0
info: { title: T, version: '1' }
paths:
  /a:
    get:
      operationId: op
      responses:
        '200':
          description: ok
          links:
            hook: { operationRef: '#/webhooks/h/get' }
webhooks:
  h:
    get:
      operationId: hg
      responses: { '200': { description: ok } }
`;

test("lists an operation-target advisory under the selected reference", async () => {
  const doc = await makeDoc(OPS_DOC, { isEntry: true });
  const screen = render(DetailPanel, {
    selected: { doc, node: at(doc.root, "/paths/~1a/get/responses/200/links/hook") },
    ctx: ctxFor(doc),
  });

  await expect.element(screen.getByText(/Resolves to/)).toBeVisible();
  await expect
    .poll(() => document.querySelector(".ref-note.advisory")?.textContent)
    .toContain("not directly callable");
  expect(document.querySelector(".ref-note.advisory.severity-error")).not.toBeNull();
});

test("Svelte auto-escaping neutralizes scalar values", async () => {
  const doc = await makeDoc(DOC, { isEntry: true });
  const node: TreeNode = {
    id: "/x",
    key: "x",
    keyKind: "property",
    valueKind: "string",
    scalarValue: "<img src=x>",
    children: [],
  };
  render(DetailPanel, { selected: { doc, node }, ctx: ctxFor(doc) });

  // The value renders as literal text, not a real element.
  await expect
    .poll(() => document.querySelector(".node-detail")?.textContent)
    .toContain("<img src=x>");
  expect(document.querySelector(".node-detail img")).toBeNull();
});
