import { expect, test, vi } from "vitest";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import OadForm from "../../src/ui/OadForm.svelte";
import type { DocInput } from "../../src/loader";
import type { RenderOutcome } from "../../src/ui/oadForm";

type OnRender = ReturnType<typeof vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>>;
const okRender = (): OnRender => vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({ ok: true }));

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".doc-row")];
const roleTexts = (): (string | null)[] => [...document.querySelectorAll(".row-role")].map((r) => r.textContent);
const fileNames = (): (string | null)[] => [...document.querySelectorAll(".file-name")].map((f) => f.textContent);

function fill(el: Element | null, value: string): void {
  const input = el as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function setFile(rowEl: HTMLElement, name: string, text = "openapi: 3.1.0\n"): Promise<void> {
  const input = rowEl.querySelector("input.file") as HTMLInputElement;
  const dt = new DataTransfer();
  dt.items.add(new File([text], name));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(rowEl.querySelector(".file-name")).not.toBeNull());
}

function fileWith(name: string, relPath: string): File {
  const f = new File(["openapi: 3.1.0\n"], name);
  Object.defineProperty(f, "webkitRelativePath", { value: relPath });
  return f;
}

async function setFolder(rowEl: HTMLElement, files: File[]): Promise<void> {
  const input = rowEl.querySelector("input.folder-input") as HTMLInputElement;
  // Use a real (live) FileList via DataTransfer — the same kind a folder picker produces,
  // which `input.value = ""` empties in place. A plain array via defineProperty would not
  // reproduce that, hiding the "selection lost on reset" bug.
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(rowEl.querySelector(".dir-summary")).not.toBeNull());
}

async function submit(): Promise<void> {
  (document.querySelector(".oad-form") as HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
}

const url = (rowEl: HTMLElement): HTMLInputElement => rowEl.querySelector("input.url") as HTMLInputElement;

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

test("the URL field label adapts to the local source", async () => {
  render(OadForm, { onRender: okRender() });
  expect(url(rows()[0]!).placeholder).toMatch(/URL to fetch/);
  await setFile(rows()[0]!, "e.yaml");
  expect(url(rows()[0]!).placeholder).toMatch(/Retrieval URL/);
});

test("the URL field becomes a folder base after a directory is chosen", async () => {
  render(OadForm, { onRender: okRender() });
  await setFolder(rows()[0]!, [fileWith("openapi.yaml", "oad/openapi.yaml")]);
  expect(url(rows()[0]!).placeholder).toMatch(/Base URL/);
});

test("submits an uploaded file as an upload input, isEntry on the first row", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  await setFile(rows()[0]!, "entry.yaml");
  await submit();
  await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
  expect(onRender.mock.calls[0]![0]).toEqual([
    { source: "upload", filename: "entry.yaml", text: "openapi: 3.1.0\n", retrievalUri: undefined, isEntry: true },
  ]);
});

test("uses the row URL as the retrieval URI when a file is also present", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  await setFile(rows()[0]!, "entry.yaml");
  fill(url(rows()[0]!), "https://example.com/entry.yaml");
  await tick();
  await submit();
  await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
  expect(onRender.mock.calls[0]![0][0]).toMatchObject({
    source: "upload",
    retrievalUri: "https://example.com/entry.yaml",
    isEntry: true,
  });
});

test("a URL with no local file becomes a fetched url input", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  fill(url(rows()[0]!), "https://a/entry.yaml");
  await tick();
  await submit();
  await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
  expect(onRender.mock.calls[0]![0]).toEqual([{ source: "url", url: "https://a/entry.yaml", isEntry: true }]);
});

test("reports a per-row presence error for an empty row and does not call onRender", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  await submit();
  await vi.waitFor(() => {
    const err = rows()[0]!.querySelector(".row-error") as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toMatch(/Add a file or folder/);
  });
  expect(onRender).not.toHaveBeenCalled();
});

test("loads a folder, defaults the entry by convention, and ignores non-OAS files", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  await setFolder(rows()[0]!, [
    fileWith("pet.yaml", "oad/schemas/pet.yaml"),
    fileWith("README.md", "oad/README.md"),
    fileWith("openapi.yaml", "oad/openapi.yaml"),
  ]);
  // Two OAS docs, the conventional one pre-selected as entry.
  expect((rows()[0]!.querySelector(".dir-count") as HTMLElement).textContent).toMatch(/2 documents/);
  const select = rows()[0]!.querySelector(".entry-select") as HTMLSelectElement;
  expect(select.value).toBe("1");
  expect(select.options[Number(select.value)]!.textContent).toBe("oad/openapi.yaml");

  await submit();
  await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
  const inputs = onRender.mock.calls[0]![0];
  expect(inputs[0]).toMatchObject({ filename: "openapi.yaml", relativePath: "oad/openapi.yaml", isEntry: true });
  expect(inputs[1]).toMatchObject({ relativePath: "oad/schemas/pet.yaml", isEntry: false });
});

test("the entry picker chooses which folder document is the entry", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  await setFolder(rows()[0]!, [fileWith("openapi.yaml", "oad/openapi.yaml"), fileWith("alt.yaml", "oad/alt.yaml")]);
  const select = rows()[0]!.querySelector(".entry-select") as HTMLSelectElement;
  // Switch the entry to alt.yaml.
  const altIndex = [...select.options].findIndex((o) => o.textContent === "oad/alt.yaml");
  select.value = String(altIndex);
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await tick();

  await submit();
  await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
  expect(onRender.mock.calls[0]![0][0]).toMatchObject({ relativePath: "oad/alt.yaml", isEntry: true });
});

test("maps the folder onto a supplied base URL", async () => {
  const onRender = okRender();
  render(OadForm, { onRender });
  await setFolder(rows()[0]!, [fileWith("openapi.yaml", "myoad/openapi.yaml"), fileWith("pet.yaml", "myoad/schemas/pet.yaml")]);
  fill(url(rows()[0]!), "https://example.com/api/");
  await tick();
  await submit();
  await vi.waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
  const inputs = onRender.mock.calls[0]![0];
  expect(inputs[0]).toMatchObject({ retrievalUri: "https://example.com/api/openapi.yaml" });
  expect(inputs[1]).toMatchObject({ retrievalUri: "https://example.com/api/schemas/pet.yaml" });
});

test("attributes a flattened-input error back to its owning row (bundle expands indices)", async () => {
  // Row 0 is a 2-doc folder (flattened inputs 0,1); row 1 is a single file (input 2).
  const onRender: OnRender = vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({
    ok: false,
    rowErrors: { 2: "second doc bad" },
  }));
  render(OadForm, { onRender });
  await setFolder(rows()[0]!, [fileWith("openapi.yaml", "oad/openapi.yaml"), fileWith("pet.yaml", "oad/schemas/pet.yaml")]);
  (document.querySelector(".add-row") as HTMLButtonElement).click();
  await tick();
  await setFile(rows()[1]!, "more.yaml");
  await submit();
  await vi.waitFor(() => {
    const err = rows()[1]!.querySelector(".row-error") as HTMLElement;
    expect(err.textContent).toBe("second doc bad");
  });
  expect((rows()[0]!.querySelector(".row-error") as HTMLElement).hidden).toBe(true);
});

test("displays an OAD-level error returned by onRender", async () => {
  const onRender: OnRender = vi.fn<(inputs: DocInput[]) => Promise<RenderOutcome>>(async () => ({
    ok: false,
    oadError: "boom",
  }));
  render(OadForm, { onRender });
  fill(url(rows()[0]!), "https://a/x.yaml");
  await tick();
  await submit();
  await vi.waitFor(() => {
    const err = document.querySelector(".oad-error") as HTMLElement;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe("boom");
  });
});

test("clears a chosen file back to the picker", async () => {
  render(OadForm, { onRender: okRender() });
  await setFile(rows()[0]!, "e.yaml");
  (rows()[0]!.querySelector(".clear-local") as HTMLButtonElement).click();
  await tick();
  expect(rows()[0]!.querySelector(".file-name")).toBeNull();
  expect(rows()[0]!.querySelector("input.file")).not.toBeNull();
});

test("promotes another row to entry with Make entry", async () => {
  render(OadForm, { onRender: okRender() });
  (document.querySelector(".add-row") as HTMLButtonElement).click();
  await tick();
  await setFile(rows()[0]!, "first.yaml");
  await setFile(rows()[1]!, "second.yaml");
  (rows()[1]!.querySelector(".make-entry") as HTMLButtonElement).click();
  await tick();
  expect(fileNames()).toEqual(["second.yaml", "first.yaml"]);
  expect(roleTexts()).toEqual(["Entry document", "Additional document 1"]);
});
