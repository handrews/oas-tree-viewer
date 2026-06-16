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
  const form = new OadForm(container, { onRender });
  return { container, onRender, form };
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

describe("OadForm folder load", () => {
  const item = (relativePath: string) => ({
    filename: relativePath.split("/").pop()!,
    relativePath,
    text: "openapi: 3.1.0\n",
  });

  it("creates one row per file with the entry chosen by convention", () => {
    const { container, form } = setup();
    form.loadFolderItems([
      item("oad/schemas/pet.yaml"),
      item("oad/openapi.yaml"),
      item("oad/schemas/error.yaml"),
    ]);
    expect(qa(container, ".doc-row")).toHaveLength(3);
    // openapi.yaml is the conventional entry, so it is promoted to first.
    expect(qa(container, ".file-name").map((f) => f.textContent)).toEqual([
      "oad/openapi.yaml",
      "oad/schemas/pet.yaml",
      "oad/schemas/error.yaml",
    ]);
    expect(qa(container, ".row-role").map((r) => r.textContent)).toEqual([
      "Entry document",
      "Additional document 1",
      "Additional document 2",
    ]);
    // "Make entry" is hidden on the entry row, shown on the others.
    const makeEntry = qa<HTMLButtonElement>(container, ".make-entry");
    expect(makeEntry.map((b) => b.hidden)).toEqual([true, false, false]);
  });

  it("loads OAS files chosen via the folder input, ignoring others", async () => {
    const { container } = setup();
    const folderInput = q<HTMLInputElement>(container, ".folder-input");
    const file = (name: string, relPath: string) => {
      const f = new File(["openapi: 3.1.0\n"], name);
      Object.defineProperty(f, "webkitRelativePath", { value: relPath });
      return f;
    };
    Object.defineProperty(folderInput, "files", {
      configurable: true,
      value: [
        file("openapi.yaml", "oad/openapi.yaml"),
        file("README.md", "oad/README.md"),
        file("pet.yaml", "oad/schemas/pet.yaml"),
      ],
    });
    folderInput.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(qa(container, ".doc-row")).toHaveLength(2));
    expect(qa(container, ".file-name").map((f) => f.textContent)).toEqual([
      "oad/openapi.yaml",
      "oad/schemas/pet.yaml",
    ]);
  });

  it("maps the folder onto a supplied base URL (stripping the folder name)", async () => {
    const { container, onRender } = setup();
    q<HTMLInputElement>(container, ".folder-base").value = "https://example.com/api/";
    const folderInput = q<HTMLInputElement>(container, ".folder-input");
    const file = (name: string, relPath: string) => {
      const f = new File(["openapi: 3.1.0\n"], name);
      Object.defineProperty(f, "webkitRelativePath", { value: relPath });
      return f;
    };
    Object.defineProperty(folderInput, "files", {
      configurable: true,
      value: [file("openapi.yaml", "myoad/openapi.yaml"), file("pet.yaml", "myoad/schemas/pet.yaml")],
    });
    folderInput.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(qa(container, ".doc-row")).toHaveLength(2));

    // Retrieval fields are pre-filled with the rebased URLs (folder name dropped).
    expect(qa<HTMLInputElement>(container, ".doc-row .retrieval").map((i) => i.value)).toEqual([
      "https://example.com/api/openapi.yaml",
      "https://example.com/api/schemas/pet.yaml",
    ]);

    submitForm(container);
    await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
    const inputs = onRender.mock.calls[0]![0];
    expect(inputs[0]).toMatchObject({
      retrievalUri: "https://example.com/api/openapi.yaml",
      relativePath: "myoad/openapi.yaml",
      isEntry: true,
    });
    expect(inputs[1]).toMatchObject({ retrievalUri: "https://example.com/api/schemas/pet.yaml" });
  });

  it("promotes another row to entry with Make entry", () => {
    const { container, form } = setup();
    form.loadFolderItems([item("a/openapi.yaml"), item("a/schemas/pet.yaml")]);
    qa<HTMLButtonElement>(qa(container, ".doc-row")[1]!, ".make-entry")[0]!.click();
    expect(qa(container, ".file-name").map((f) => f.textContent)).toEqual([
      "a/schemas/pet.yaml",
      "a/openapi.yaml",
    ]);
    expect(qa(container, ".row-role")[0]!.textContent).toBe("Entry document");
  });

  it("submits preloaded rows as uploads carrying the relative path", async () => {
    const { container, form, onRender } = setup();
    form.loadFolderItems([item("oad/openapi.yaml"), item("oad/schemas/pet.yaml")]);
    submitForm(container);
    await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
    const inputs = onRender.mock.calls[0]![0];
    expect(inputs[0]).toMatchObject({
      source: "upload",
      filename: "openapi.yaml",
      relativePath: "oad/openapi.yaml",
      isEntry: true,
    });
    expect(inputs[1]).toMatchObject({ relativePath: "oad/schemas/pet.yaml", isEntry: false });
  });
});
