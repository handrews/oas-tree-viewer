import { expect, test, vi } from "vitest";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import OadForm from "../../src/ui/OadForm.svelte";
import type { DocInput } from "../../src/loader";
import type { RenderOutcome } from "../../src/ui/oadForm";

type OnRender = ReturnType<typeof vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>>;
const okRender = (): OnRender => vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({ ok: true }));

const roleTexts = (): (string | null)[] => [...document.querySelectorAll(".row-role")].map((r) => r.textContent);
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".doc-row")];
const fileNames = (): (string | null)[] => [...document.querySelectorAll(".file-name")].map((f) => f.textContent);

function fill(el: Element | null, value: string): void {
  const input = el as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function useUrl(rowEl: HTMLElement, url: string): Promise<void> {
  (rowEl.querySelector('.src[value="url"]') as HTMLInputElement).click();
  await tick();
  fill(rowEl.querySelector(".url"), url);
  await tick();
}

async function submit(): Promise<void> {
  (document.querySelector(".oad-form") as HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
}

function fileWith(name: string, relPath: string): File {
  const f = new File(["openapi: 3.1.0\n"], name);
  Object.defineProperty(f, "webkitRelativePath", { value: relPath });
  return f;
}

function loadFolder(files: File[]): void {
  const folderInput = document.querySelector(".folder-input") as HTMLInputElement;
  Object.defineProperty(folderInput, "files", { configurable: true, value: files });
  folderInput.dispatchEvent(new Event("change", { bubbles: true }));
}

test("starts with a single entry row", () => {
  render(OadForm, { onRender: okRender() });
  expect(roleTexts()).toEqual(["Entry document"]);
});

test("re-labels on add and promotes the entry when the first row is removed", async () => {
  render(OadForm, { onRender: okRender() });
  (document.querySelector(".add-row") as HTMLButtonElement).click();
  await tick();
  (document.querySelector(".add-row") as HTMLButtonElement).click();
  await tick();
  expect(roleTexts()).toEqual(["Entry document", "Additional document 1", "Additional document 2"]);

  (rows()[0]!.querySelector(".remove") as HTMLButtonElement).click();
  await tick();
  expect(roleTexts()).toEqual(["Entry document", "Additional document 1"]);
});

test("toggles upload vs URL fields", async () => {
  render(OadForm, { onRender: okRender() });
  const row = rows()[0]!;
  expect((row.querySelector(".url-fields") as HTMLElement).hidden).toBe(true);
  (row.querySelector('.src[value="url"]') as HTMLInputElement).click();
  await tick();
  expect((row.querySelector(".url-fields") as HTMLElement).hidden).toBe(false);
  expect((row.querySelector(".upload-fields") as HTMLElement).hidden).toBe(true);
});

test("submits URL inputs with isEntry on the first row only", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  (document.querySelector(".add-row") as HTMLButtonElement).click();
  await tick();
  await useUrl(rows()[0]!, "https://a/entry.yaml");
  await useUrl(rows()[1]!, "https://a/shared.yaml");
  await submit();
  await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
  expect(onRender.mock.calls[0]![0]).toEqual([
    { source: "url", url: "https://a/entry.yaml", isEntry: true },
    { source: "url", url: "https://a/shared.yaml", isEntry: false },
  ]);
});

test("reports a per-row error for an empty URL and does not call onRender", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  (rows()[0]!.querySelector('.src[value="url"]') as HTMLInputElement).click();
  await tick();
  await submit();
  await vi.waitFor(() => {
    const err = rows()[0]!.querySelector(".row-error") as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain("Enter a URL");
  });
  expect(onRender).not.toHaveBeenCalled();
});

test("reports a per-row error for a missing file", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  await submit(); // default row is upload with no file
  await vi.waitFor(() =>
    expect((rows()[0]!.querySelector(".row-error") as HTMLElement).textContent).toContain("Choose a file"),
  );
  expect(onRender).not.toHaveBeenCalled();
});

test("displays an OAD-level error returned by onRender", async () => {
  const onRender: OnRender = vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({
    ok: false,
    oadError: "boom",
  }));
  render(OadForm, { onRender });
  await useUrl(rows()[0]!, "https://a/x.yaml");
  await submit();
  await vi.waitFor(() => {
    const err = document.querySelector(".oad-error") as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe("boom");
  });
});

test("displays per-row errors returned by onRender", async () => {
  const onRender: OnRender = vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({
    ok: false,
    rowErrors: { 0: "bad doc" },
  }));
  render(OadForm, { onRender });
  await useUrl(rows()[0]!, "https://a/x.yaml");
  await submit();
  await vi.waitFor(() =>
    expect((document.querySelector(".row-error") as HTMLElement).textContent).toBe("bad doc"),
  );
});

test("loads a folder, choosing the entry by convention and ignoring non-OAS files", async () => {
  render(OadForm, { onRender: okRender() });
  loadFolder([
    fileWith("pet.yaml", "oad/schemas/pet.yaml"),
    fileWith("README.md", "oad/README.md"),
    fileWith("openapi.yaml", "oad/openapi.yaml"),
  ]);
  await vi.waitFor(() => expect(rows()).toHaveLength(2));
  expect(fileNames()).toEqual(["oad/openapi.yaml", "oad/schemas/pet.yaml"]);
  expect(roleTexts()).toEqual(["Entry document", "Additional document 1"]);
  expect([...document.querySelectorAll<HTMLButtonElement>(".make-entry")].map((b) => b.hidden)).toEqual([
    true,
    false,
  ]);
});

test("maps the folder onto a supplied base URL (folder name dropped)", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  fill(document.querySelector(".folder-base"), "https://example.com/api/");
  await tick();
  loadFolder([fileWith("openapi.yaml", "myoad/openapi.yaml"), fileWith("pet.yaml", "myoad/schemas/pet.yaml")]);
  await vi.waitFor(() => expect(rows()).toHaveLength(2));

  await expect
    .poll(() => [...document.querySelectorAll<HTMLInputElement>(".doc-row .retrieval")].map((i) => i.value))
    .toEqual(["https://example.com/api/openapi.yaml", "https://example.com/api/schemas/pet.yaml"]);

  await submit();
  await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
  const inputs = onRender.mock.calls[0]![0];
  expect(inputs[0]).toMatchObject({
    retrievalUri: "https://example.com/api/openapi.yaml",
    relativePath: "myoad/openapi.yaml",
    isEntry: true,
  });
  expect(inputs[1]).toMatchObject({ retrievalUri: "https://example.com/api/schemas/pet.yaml" });
});

test("promotes another row to entry with Make entry", async () => {
  render(OadForm, { onRender: okRender() });
  loadFolder([fileWith("openapi.yaml", "a/openapi.yaml"), fileWith("pet.yaml", "a/schemas/pet.yaml")]);
  await vi.waitFor(() => expect(rows()).toHaveLength(2));
  (rows()[1]!.querySelector(".make-entry") as HTMLButtonElement).click();
  await tick();
  expect(fileNames()).toEqual(["a/schemas/pet.yaml", "a/openapi.yaml"]);
  expect(roleTexts()[0]).toBe("Entry document");
});

test("submits preloaded rows as uploads carrying the relative path", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  loadFolder([fileWith("openapi.yaml", "oad/openapi.yaml"), fileWith("pet.yaml", "oad/schemas/pet.yaml")]);
  await vi.waitFor(() => expect(rows()).toHaveLength(2));
  await submit();
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
