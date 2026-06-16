// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { OadForm } from "../../src/ui/oadForm";
import type { RenderOutcome } from "../../src/ui/oadForm";
import type { DocInput } from "../../src/loader";

type OnRender = Mock<(inputs: DocInput[]) => Promise<RenderOutcome>>;

function setup(
  onRender: OnRender = vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({
    ok: true,
  })),
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  new OadForm(container, { onRender });
  return { container, onRender };
}

const q = <T extends HTMLElement>(c: ParentNode, s: string) => c.querySelector<T>(s)!;
const qa = <T extends HTMLElement>(c: ParentNode, s: string) => [...c.querySelectorAll<T>(s)];

function submitForm(container: HTMLElement): void {
  q<HTMLFormElement>(container, ".oad-form").dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}

function useUrl(row: HTMLElement, url: string): void {
  q<HTMLInputElement>(row, '.src[value="url"]').click();
  q<HTMLInputElement>(row, ".url").value = url;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("OadForm rows", () => {
  it("starts with a single entry row", () => {
    const { container } = setup();
    expect(qa(container, ".row-role").map((r) => r.textContent)).toEqual(["Entry document"]);
  });

  it("re-labels on add and promotes the entry when the first row is removed", () => {
    const { container } = setup();
    q(container, ".add-row").click();
    q(container, ".add-row").click();
    expect(qa(container, ".row-role").map((r) => r.textContent)).toEqual([
      "Entry document",
      "Additional document 1",
      "Additional document 2",
    ]);
    qa<HTMLButtonElement>(container, ".doc-row .remove")[0]!.click();
    expect(qa(container, ".row-role").map((r) => r.textContent)).toEqual([
      "Entry document",
      "Additional document 1",
    ]);
  });

  it("toggles upload vs URL fields", () => {
    const { container } = setup();
    const row = q(container, ".doc-row");
    expect(q<HTMLElement>(row, ".url-fields").hidden).toBe(true);
    q<HTMLInputElement>(row, '.src[value="url"]').click();
    expect(q<HTMLElement>(row, ".url-fields").hidden).toBe(false);
    expect(q<HTMLElement>(row, ".upload-fields").hidden).toBe(true);
  });
});

describe("OadForm submit", () => {
  it("reports a per-row error for an empty URL", async () => {
    const { container, onRender } = setup();
    q<HTMLInputElement>(q(container, ".doc-row"), '.src[value="url"]').click();
    submitForm(container);
    await vi.waitFor(() => {
      const err = q<HTMLElement>(container, ".row-error");
      expect(err.hidden).toBe(false);
      expect(err.textContent).toContain("Enter a URL");
    });
    expect(onRender).not.toHaveBeenCalled();
  });

  it("reports a per-row error for a missing file", async () => {
    const { container, onRender } = setup();
    submitForm(container); // default row is upload with no file
    await vi.waitFor(() => {
      expect(q<HTMLElement>(container, ".row-error").textContent).toContain("Choose a file");
    });
    expect(onRender).not.toHaveBeenCalled();
  });

  it("submits URL inputs with isEntry on the first row only", async () => {
    const { container, onRender } = setup();
    q(container, ".add-row").click();
    const rows = qa(container, ".doc-row");
    useUrl(rows[0]!, "https://a/entry.yaml");
    useUrl(rows[1]!, "https://a/shared.yaml");
    submitForm(container);
    await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
    expect(onRender.mock.calls[0]![0]).toEqual([
      { source: "url", url: "https://a/entry.yaml", isEntry: true },
      { source: "url", url: "https://a/shared.yaml", isEntry: false },
    ]);
  });

  it("displays an OAD-level error returned by onRender", async () => {
    const onRender: OnRender = vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({
      ok: false,
      oadError: "boom",
    }));
    const { container } = setup(onRender);
    useUrl(q(container, ".doc-row"), "https://a/x.yaml");
    submitForm(container);
    await vi.waitFor(() => {
      const err = q<HTMLElement>(container, ".oad-error");
      expect(err.hidden).toBe(false);
      expect(err.textContent).toBe("boom");
    });
  });

  it("displays per-row errors returned by onRender", async () => {
    const onRender: OnRender = vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({
      ok: false,
      rowErrors: { 0: "bad doc" },
    }));
    const { container } = setup(onRender);
    useUrl(q(container, ".doc-row"), "https://a/x.yaml");
    submitForm(container);
    await vi.waitFor(() => {
      expect(q<HTMLElement>(container, ".row-error").textContent).toBe("bad doc");
    });
  });
});
