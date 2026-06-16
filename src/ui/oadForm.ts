// The multi-document OAD input form. Collects an ordered list of documents — each a
// local upload (with optional retrieval URL) or a URL fetch — with exactly one marked
// as the entry document, then hands the inputs to the caller to load and render.
// Per-row and OAD-level errors are displayed back in the form.

import type { DocInput } from "../loader";

export interface RenderOutcome {
  ok: boolean;
  /** Per-row errors keyed by the row's index in the submitted input list. */
  rowErrors?: Record<number, string>;
  /** An OAD-level error (entry count, version mismatch). */
  oadError?: string;
}

export interface OadFormCallbacks {
  onRender: (inputs: DocInput[]) => Promise<RenderOutcome>;
}

const ENTRY_RADIO_NAME = "oad-entry";
let nextRowSeq = 1;

export class OadForm {
  private readonly rowsWrap: HTMLElement;
  private readonly oadErrorEl: HTMLElement;
  private readonly cb: OadFormCallbacks;
  private rows: DocRow[] = [];

  constructor(container: HTMLElement, cb: OadFormCallbacks) {
    this.cb = cb;
    container.innerHTML = `
      <form class="oad-form" novalidate>
        <p class="form-intro">
          Add the documents that make up your OpenAPI Description. Mark exactly one as the
          <strong>entry document</strong>. Every document must be a complete OpenAPI 3.1 or 3.2
          document; all documents must share the same version.
        </p>
        <div class="rows"></div>
        <div class="form-actions">
          <button type="button" class="add-row">+ Add document</button>
          <button type="submit" class="render">Render OAD</button>
        </div>
        <p class="oad-error" hidden></p>
      </form>
    `;

    const form = container.querySelector<HTMLFormElement>(".oad-form")!;
    this.rowsWrap = form.querySelector<HTMLElement>(".rows")!;
    this.oadErrorEl = form.querySelector<HTMLElement>(".oad-error")!;

    form.querySelector<HTMLButtonElement>(".add-row")!.addEventListener("click", () => this.addRow(false));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.submit();
    });

    this.addRow(true);
  }

  private addRow(isEntry: boolean): void {
    const row = new DocRow(() => this.removeRow(row));
    this.rows.push(row);
    this.rowsWrap.appendChild(row.el);
    if (isEntry) row.setEntry(true);
    this.updateRemoveButtons();
  }

  private removeRow(row: DocRow): void {
    const wasEntry = row.isEntry();
    this.rows = this.rows.filter((r) => r !== row);
    row.el.remove();
    // Keep exactly-one-entry easy: if we removed the entry, promote the first row.
    if (wasEntry && this.rows.length > 0) this.rows[0]!.setEntry(true);
    this.updateRemoveButtons();
  }

  private updateRemoveButtons(): void {
    const removable = this.rows.length > 1;
    this.rows.forEach((r) => r.setRemovable(removable));
  }

  private async submit(): Promise<void> {
    this.setOadError(null);
    this.rows.forEach((r) => r.setError(null));

    // Collect inputs; presence problems (no file / no URL) are reported per row.
    const inputs: DocInput[] = [];
    let hadPresenceError = false;
    for (const row of this.rows) {
      try {
        inputs.push(await row.collect());
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

/** One document row in the form. Owns its DOM and reads its own state on demand. */
class DocRow {
  readonly el: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly retrievalInput: HTMLInputElement;
  private readonly urlInput: HTMLInputElement;
  private readonly entryRadio: HTMLInputElement;
  private readonly uploadFields: HTMLElement;
  private readonly urlFields: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly removeBtn: HTMLButtonElement;

  constructor(onRemove: () => void) {
    const srcName = `src-${nextRowSeq++}`;
    this.el = document.createElement("fieldset");
    this.el.className = "doc-row";
    this.el.innerHTML = `
      <div class="row-top">
        <label class="entry-label">
          <input type="radio" name="${ENTRY_RADIO_NAME}" class="entry" />
          <span>Entry document</span>
        </label>
        <div class="source-toggle">
          <label><input type="radio" name="${srcName}" class="src" value="upload" checked /> Upload</label>
          <label><input type="radio" name="${srcName}" class="src" value="url" /> URL</label>
        </div>
        <button type="button" class="remove" title="Remove document">×</button>
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

    this.entryRadio = this.q(".entry");
    this.fileInput = this.q(".file");
    this.retrievalInput = this.q(".retrieval");
    this.urlInput = this.q(".url");
    this.uploadFields = this.q(".upload-fields");
    this.urlFields = this.q(".url-fields");
    this.errorEl = this.q(".row-error");
    this.removeBtn = this.q(".remove");

    this.removeBtn.addEventListener("click", onRemove);
    this.el.querySelectorAll<HTMLInputElement>(".src").forEach((radio) =>
      radio.addEventListener("change", () => this.updateSource()),
    );
  }

  isEntry(): boolean {
    return this.entryRadio.checked;
  }

  setEntry(value: boolean): void {
    this.entryRadio.checked = value;
  }

  setRemovable(value: boolean): void {
    this.removeBtn.disabled = !value;
    this.removeBtn.style.visibility = value ? "visible" : "hidden";
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
  async collect(): Promise<DocInput> {
    const isEntry = this.isEntry();
    if (this.currentSource() === "url") {
      const url = this.urlInput.value.trim();
      if (!url) throw new Error("Enter a URL to fetch, or switch this row to Upload.");
      return { source: "url", url, isEntry };
    }
    const file = this.fileInput.files?.[0];
    if (!file) throw new Error("Choose a file to upload, or switch this row to URL.");
    const text = await file.text();
    const retrievalUri = this.retrievalInput.value.trim() || undefined;
    return { source: "upload", filename: file.name, text, retrievalUri, isEntry };
  }

  private currentSource(): "upload" | "url" {
    const checked = this.el.querySelector<HTMLInputElement>(".src:checked");
    return checked?.value === "url" ? "url" : "upload";
  }

  private updateSource(): void {
    const isUrl = this.currentSource() === "url";
    this.urlFields.hidden = !isUrl;
    this.uploadFields.hidden = isUrl;
  }

  private q<T extends HTMLElement>(selector: string): T {
    return this.el.querySelector<T>(selector)!;
  }
}
