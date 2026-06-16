// The multi-document OAD input form. Collects an ordered list of documents — each a
// local upload (with optional retrieval URL) or a URL fetch. The first document is the
// entry document; "Make entry" promotes another row to the front. A "Load folder" action
// loads a whole directory at once, preserving each file's relative path so subdirectory
// references resolve. Per-row and OAD-level errors are displayed back in the form.

import type { DocInput } from "../loader";

export interface RenderOutcome {
  ok: boolean;
  /** Per-row errors keyed by the row's index in the submitted input list. */
  rowErrors?: Record<number, string>;
  /** An OAD-level error (currently only version mismatch). */
  oadError?: string;
}

export interface OadFormCallbacks {
  onRender: (inputs: DocInput[]) => Promise<RenderOutcome>;
}

/** A file read from a directory upload, carrying its path relative to the folder. */
export interface FolderDoc {
  filename: string;
  relativePath: string;
  text: string;
  /** Retrieval URI when a folder base URL was supplied (overrides the file:// base). */
  retrievalUri?: string;
}

const DOC_FILE = /\.(json|ya?ml)$/i;

let nextRowSeq = 1;

export class OadForm {
  private readonly rowsWrap: HTMLElement;
  private readonly oadErrorEl: HTMLElement;
  private readonly folderBaseInput: HTMLInputElement;
  private readonly cb: OadFormCallbacks;
  private rows: DocRow[] = [];

  constructor(container: HTMLElement, cb: OadFormCallbacks) {
    this.cb = cb;
    container.innerHTML = `
      <form class="oad-form" novalidate>
        <p class="form-intro">
          Add the documents that make up your OpenAPI Description. The <strong>first
          document is the entry document</strong>; any others are additional (referenced)
          documents. Or <strong>Load folder</strong> to add a whole directory at once
          (relative paths are preserved); supply a base URL to map the folder onto a server
          path instead of the implicit <code>file://</code> base. Every document must be a
          complete OpenAPI 3.1 or 3.2 document, and all documents must share the same version.
        </p>
        <div class="rows"></div>
        <div class="form-actions">
          <button type="button" class="add-row">+ Add document</button>
          <button type="button" class="add-folder">Load folder…</button>
          <input type="url" class="folder-base" placeholder="Base URL for the folder (optional)" />
          <input type="file" class="folder-input" webkitdirectory multiple hidden />
          <button type="submit" class="render">Render OAD</button>
        </div>
        <p class="oad-error" hidden></p>
      </form>
    `;

    const form = container.querySelector<HTMLFormElement>(".oad-form")!;
    this.rowsWrap = form.querySelector<HTMLElement>(".rows")!;
    this.oadErrorEl = form.querySelector<HTMLElement>(".oad-error")!;

    form.querySelector<HTMLButtonElement>(".add-row")!.addEventListener("click", () => this.addRow());

    this.folderBaseInput = form.querySelector<HTMLInputElement>(".folder-base")!;
    const folderInput = form.querySelector<HTMLInputElement>(".folder-input")!;
    form
      .querySelector<HTMLButtonElement>(".add-folder")!
      .addEventListener("click", () => folderInput.click());
    folderInput.addEventListener("change", () => void this.onFolderSelected(folderInput));

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.submit();
    });

    this.addRow();
  }

  /** Replace the current rows with one per document from a folder, entry first. */
  loadFolderItems(items: FolderDoc[]): void {
    if (items.length === 0) return;
    this.rows.forEach((r) => r.el.remove());
    this.rows = [];
    this.setOadError(null);

    const entryIndex = pickEntryIndex(items);
    const ordered = [items[entryIndex]!, ...items.filter((_, i) => i !== entryIndex)];
    for (const item of ordered) this.addRow(item);
  }

  private async onFolderSelected(input: HTMLInputElement): Promise<void> {
    const baseUrl = this.folderBaseInput.value.trim();
    const files = [...(input.files ?? [])].filter((f) => DOC_FILE.test(f.name));
    const items: FolderDoc[] = await Promise.all(
      files.map(async (f) => {
        const relativePath = f.webkitRelativePath || f.name;
        return {
          filename: f.name,
          relativePath,
          text: await f.text(),
          retrievalUri: baseUrl ? rebaseFolderUri(relativePath, baseUrl) : undefined,
        };
      }),
    );
    input.value = ""; // allow re-selecting the same folder
    this.loadFolderItems(items);
  }

  private addRow(preloaded?: FolderDoc): void {
    const row = new DocRow(
      () => this.removeRow(row),
      () => this.makeEntry(row),
      preloaded,
    );
    this.rows.push(row);
    this.rowsWrap.appendChild(row.el);
    this.refreshRows();
  }

  private removeRow(row: DocRow): void {
    this.rows = this.rows.filter((r) => r !== row);
    row.el.remove();
    this.refreshRows();
  }

  private makeEntry(row: DocRow): void {
    this.rows = [row, ...this.rows.filter((r) => r !== row)];
    this.rowsWrap.prepend(row.el);
    this.refreshRows();
  }

  /** Keep each row's role label, remove, and make-entry controls in sync with position. */
  private refreshRows(): void {
    const removable = this.rows.length > 1;
    this.rows.forEach((row, i) => {
      row.setRole(i === 0 ? "Entry document" : `Additional document ${i}`, i === 0);
      row.setRemovable(removable);
      row.setEntryCandidate(i !== 0);
    });
  }

  private async submit(): Promise<void> {
    this.setOadError(null);
    this.rows.forEach((r) => r.setError(null));

    // Collect inputs; presence problems (no file / no URL) are reported per row.
    // The first row is always the entry document.
    const inputs: DocInput[] = [];
    let hadPresenceError = false;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      try {
        inputs.push(await row.collect(i === 0));
      } catch (e) {
        row.setError(e instanceof Error ? e.message : String(e));
        hadPresenceError = true;
      }
    }
    if (hadPresenceError) return;

    const outcome = await this.cb.onRender(inputs);
    if (outcome.ok) return;

    if (outcome.rowErrors) {
      for (const [index, message] of Object.entries(outcome.rowErrors)) {
        this.rows[Number(index)]?.setError(message);
      }
    }
    if (outcome.oadError) this.setOadError(outcome.oadError);
  }

  private setOadError(message: string | null): void {
    if (message) {
      this.oadErrorEl.textContent = message;
      this.oadErrorEl.hidden = false;
    } else {
      this.oadErrorEl.textContent = "";
      this.oadErrorEl.hidden = true;
    }
  }
}

/**
 * Map a file's folder-relative path onto a supplied base URL, standing in for the implicit
 * `file://<folder>/` base. `webkitRelativePath` is prefixed with the chosen folder's name,
 * which is stripped so the base URL corresponds to that folder. Returns undefined if the
 * base URL can't be used (e.g. it is not absolute).
 */
function rebaseFolderUri(relativePath: string, baseUrl: string): string | undefined {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const withinFolder = relativePath.split("/").slice(1).join("/") || relativePath;
  try {
    return new URL(withinFolder, base).href;
  } catch {
    return undefined;
  }
}

/** Choose the entry: a conventionally-named file, else the shallowest path. */
function pickEntryIndex(items: FolderDoc[]): number {
  const conventional = items.findIndex((it) => /^openapi\.(ya?ml|json)$/i.test(it.filename));
  if (conventional >= 0) return conventional;
  let best = 0;
  items.forEach((it, i) => {
    if (it.relativePath.split("/").length < items[best]!.relativePath.split("/").length) best = i;
  });
  return best;
}

/** One document row in the form. Owns its DOM and reads its own state on demand. */
class DocRow {
  readonly el: HTMLElement;
  private readonly preloaded: FolderDoc | undefined;
  private readonly roleEl: HTMLElement;
  private readonly retrievalInput: HTMLInputElement;
  private readonly errorEl: HTMLElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly makeEntryBtn: HTMLButtonElement;
  // Manual rows only:
  private readonly fileInput: HTMLInputElement | undefined;
  private readonly urlInput: HTMLInputElement | undefined;
  private readonly uploadFields: HTMLElement | undefined;
  private readonly urlFields: HTMLElement | undefined;

  constructor(onRemove: () => void, onMakeEntry: () => void, preloaded?: FolderDoc) {
    this.preloaded = preloaded;
    this.el = document.createElement("fieldset");
    this.el.className = "doc-row";
    this.el.innerHTML = preloaded ? preloadedMarkup() : manualMarkup(`src-${nextRowSeq++}`);

    this.roleEl = this.q(".row-role");
    this.retrievalInput = this.q(".retrieval");
    this.errorEl = this.q(".row-error");
    this.removeBtn = this.q(".remove");
    this.makeEntryBtn = this.q(".make-entry");

    this.removeBtn.addEventListener("click", onRemove);
    this.makeEntryBtn.addEventListener("click", onMakeEntry);

    if (preloaded) {
      this.q<HTMLElement>(".file-name").textContent = preloaded.relativePath;
      if (preloaded.retrievalUri) this.retrievalInput.value = preloaded.retrievalUri;
    } else {
      this.fileInput = this.q<HTMLInputElement>(".file");
      this.urlInput = this.q<HTMLInputElement>(".url");
      this.uploadFields = this.q<HTMLElement>(".upload-fields");
      this.urlFields = this.q<HTMLElement>(".url-fields");
      this.el
        .querySelectorAll<HTMLInputElement>(".src")
        .forEach((radio) => radio.addEventListener("change", () => this.updateSource()));
    }
  }

  setRole(text: string, isEntry: boolean): void {
    this.roleEl.textContent = text;
    this.roleEl.classList.toggle("is-entry", isEntry);
  }

  setRemovable(value: boolean): void {
    this.removeBtn.disabled = !value;
    this.removeBtn.style.visibility = value ? "visible" : "hidden";
  }

  /** Show the "Make entry" control only on non-entry rows. */
  setEntryCandidate(value: boolean): void {
    this.makeEntryBtn.hidden = !value;
  }

  setError(message: string | null): void {
    if (message) {
      this.errorEl.textContent = message;
      this.errorEl.hidden = false;
      this.el.classList.add("has-error");
    } else {
      this.errorEl.textContent = "";
      this.errorEl.hidden = true;
      this.el.classList.remove("has-error");
    }
  }

  /** Build the DocInput for this row, throwing on missing file/URL. */
  async collect(isEntry: boolean): Promise<DocInput> {
    const retrievalUri = this.retrievalInput.value.trim() || undefined;

    if (this.preloaded) {
      return {
        source: "upload",
        filename: this.preloaded.filename,
        text: this.preloaded.text,
        relativePath: this.preloaded.relativePath,
        retrievalUri,
        isEntry,
      };
    }

    if (this.currentSource() === "url") {
      const url = this.urlInput!.value.trim();
      if (!url) throw new Error("Enter a URL to fetch, or switch this row to Upload.");
      return { source: "url", url, isEntry };
    }
    const file = this.fileInput!.files?.[0];
    if (!file) throw new Error("Choose a file to upload, or switch this row to URL.");
    return { source: "upload", filename: file.name, text: await file.text(), retrievalUri, isEntry };
  }

  private currentSource(): "upload" | "url" {
    const checked = this.el.querySelector<HTMLInputElement>(".src:checked");
    return checked?.value === "url" ? "url" : "upload";
  }

  private updateSource(): void {
    const isUrl = this.currentSource() === "url";
    if (this.urlFields) this.urlFields.hidden = !isUrl;
    if (this.uploadFields) this.uploadFields.hidden = isUrl;
  }

  private q<T extends HTMLElement>(selector: string): T {
    return this.el.querySelector<T>(selector)!;
  }
}

function rowActions(): string {
  return `
    <div class="row-actions">
      <button type="button" class="make-entry" title="Make this the entry document" hidden>Make entry</button>
      <button type="button" class="remove" title="Remove document">×</button>
    </div>`;
}

function manualMarkup(srcName: string): string {
  return `
    <div class="row-top">
      <span class="row-role"></span>
      <div class="source-toggle">
        <label><input type="radio" name="${srcName}" class="src" value="upload" checked /> Upload</label>
        <label><input type="radio" name="${srcName}" class="src" value="url" /> URL</label>
      </div>
      ${rowActions()}
    </div>
    <div class="upload-fields">
      <input type="file" class="file" accept=".json,.yaml,.yml,application/json,text/yaml" />
      <input type="url" class="retrieval" placeholder="Retrieval URL (optional — base URI this file came from)" />
    </div>
    <div class="url-fields" hidden>
      <input type="url" class="url" placeholder="https://example.com/openapi.yaml" />
    </div>
    <p class="row-error" hidden></p>
  `;
}

function preloadedMarkup(): string {
  return `
    <div class="row-top">
      <span class="row-role"></span>
      <span class="file-name" title="path within the folder"></span>
      ${rowActions()}
    </div>
    <div class="upload-fields">
      <input type="url" class="retrieval" placeholder="Retrieval URL (optional — overrides the file:// base)" />
    </div>
    <p class="row-error" hidden></p>
  `;
}
