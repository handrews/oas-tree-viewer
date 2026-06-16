// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { clearDetail, renderDetail, renderLegend } from "../../src/render/detailPanel";
import type { DetailContext } from "../../src/render/detailPanel";
import { resolveOad } from "../../src/refs/resolver";
import type { OadDocument, TreeNode } from "../../src/types";
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

let doc: OadDocument;
let ctx: DetailContext;
let onNavigate: Mock<(docId: string, nodeId: string) => void>;

function at(pointer: string): TreeNode {
  const find = (n: TreeNode): TreeNode | undefined => {
    if (n.id === pointer) return n;
    for (const c of n.children) {
      const r = find(c);
      if (r) return r;
    }
    return undefined;
  };
  return find(doc.root)!;
}

function panel(): HTMLElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  renderLegend(c);
  return c;
}

const detailText = (c: HTMLElement) => c.querySelector(".node-detail")!.textContent!;

beforeEach(async () => {
  document.body.innerHTML = "";
  doc = await makeDoc(DOC, { isEntry: true });
  onNavigate = vi.fn<(docId: string, nodeId: string) => void>();
  ctx = { refs: resolveOad(makeOad(doc)), docLabel: () => "doc.yaml", onNavigate };
});

describe("renderLegend", () => {
  it("renders the legend and an empty detail", () => {
    const c = panel();
    expect(c.querySelector(".legend")).toBeTruthy();
    expect(c.querySelector(".node-detail.empty")).toBeTruthy();
  });
});

describe("renderDetail", () => {
  it("shows basic node info", () => {
    const c = panel();
    renderDetail(c, doc, at("/components/schemas/S"), ctx);
    expect(detailText(c)).toContain("Schema Object");
    expect(detailText(c)).toContain("#/components/schemas/S");
  });

  it("lists incoming references with their statuses and wires navigation", () => {
    const c = panel();
    renderDetail(c, doc, at("/components/schemas/S"), ctx);
    const badges = [...c.querySelectorAll(".ref-section .ref-item .ref-badge")]
      .map((b) => b.textContent)
      .sort();
    expect(badges).toEqual(["resolved", "type-mismatch"]);
    c.querySelector<HTMLElement>(".nav-ref")!.click();
    expect(onNavigate).toHaveBeenCalled();
  });

  it("shows the type-mismatch note on a reference source", () => {
    const c = panel();
    renderDetail(c, doc, at("/paths/~1a/get/parameters/0"), ctx);
    expect(detailText(c)).toContain("Resolves to");
    expect(detailText(c)).toContain("expected Parameter, found Schema");
  });

  it("shows an external reference with its status and no nav link", () => {
    const c = panel();
    renderDetail(c, doc, at("/paths/~1a/get/parameters/1"), ctx);
    const item = c.querySelector(".ref-section .ref-item")!;
    expect(item.querySelector(".ref-badge")!.textContent).toBe("external");
    expect(item.querySelector(".nav-ref")).toBeNull();
    expect(item.textContent).toContain("target document not loaded");
  });

  it("escapes HTML in scalar values", () => {
    const c = panel();
    const node: TreeNode = {
      id: "/x",
      key: "x",
      keyKind: "property",
      valueKind: "string",
      scalarValue: "<img src=x>",
      children: [],
    };
    renderDetail(c, doc, node, ctx);
    const html = c.querySelector(".node-detail")!.innerHTML;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("clearDetail", () => {
  it("resets to the empty hint", () => {
    const c = panel();
    renderDetail(c, doc, at("/components/schemas/S"), ctx);
    clearDetail(c);
    expect(c.querySelector(".node-detail.empty")).toBeTruthy();
  });
});
