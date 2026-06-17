<script lang="ts">
  // Multi-document OAD input form. Each row is a local upload (optional retrieval URL) or
  // a URL fetch; the first row is the entry document. "Load folder" replaces the rows with
  // one per file in a directory, preserving relative paths. All row state lives here so
  // submit can collect it; the pure bits are imported from ./oadForm.
  import type { DocInput } from "../loader";
  import {
    DOC_FILE,
    rebaseFolderUri,
    pickEntryIndex,
    type RenderOutcome,
    type FolderDoc,
  } from "./oadForm";

  let { onRender }: { onRender: (inputs: DocInput[]) => Promise<RenderOutcome> } = $props();

  interface RowState {
    id: number;
    preloaded?: { filename: string; relativePath: string; text: string };
    source: "upload" | "url";
    files: FileList | null;
    retrievalUri: string;
    url: string;
    error: string | null;
  }

  let nextId = 1;
  function manualRow(): RowState {
    return { id: nextId++, source: "upload", files: null, retrievalUri: "", url: "", error: null };
  }
  function preloadedRow(item: FolderDoc): RowState {
    return {
      id: nextId++,
      preloaded: { filename: item.filename, relativePath: item.relativePath, text: item.text },
      source: "upload",
      files: null,
      retrievalUri: item.retrievalUri ?? "",
      url: "",
      error: null,
    };
  }

  let rows = $state<RowState[]>([manualRow()]);
  let oadError = $state<string | null>(null);
  let folderBase = $state("");
  let folderInputEl: HTMLInputElement;

  const removable = $derived(rows.length > 1);
  const roleLabel = (i: number): string => (i === 0 ? "Entry document" : `Additional document ${i}`);

  function addRow(): void {
    rows = [...rows, manualRow()];
  }
  function removeRow(row: RowState): void {
    rows = rows.filter((r) => r !== row);
  }
  function makeEntry(row: RowState): void {
    rows = [row, ...rows.filter((r) => r !== row)];
  }

  function loadFolderItems(items: FolderDoc[]): void {
    if (items.length === 0) return;
    oadError = null;
    const entryIndex = pickEntryIndex(items);
    const ordered = [items[entryIndex]!, ...items.filter((_, i) => i !== entryIndex)];
    rows = ordered.map(preloadedRow);
  }

  async function onFolderChange(): Promise<void> {
    const input = folderInputEl;
    const baseUrl = folderBase.trim();
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
    loadFolderItems(items);
  }

  async function collect(row: RowState, isEntry: boolean): Promise<DocInput> {
    const retrievalUri = row.retrievalUri.trim() || undefined;

    if (row.preloaded) {
      return {
        source: "upload",
        filename: row.preloaded.filename,
        text: row.preloaded.text,
        relativePath: row.preloaded.relativePath,
        retrievalUri,
        isEntry,
      };
    }
    if (row.source === "url") {
      const url = row.url.trim();
      if (!url) throw new Error("Enter a URL to fetch, or switch this row to Upload.");
      return { source: "url", url, isEntry };
    }
    const file = row.files?.[0];
    if (!file) throw new Error("Choose a file to upload, or switch this row to URL.");
    return { source: "upload", filename: file.name, text: await file.text(), retrievalUri, isEntry };
  }

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    oadError = null;
    for (const r of rows) r.error = null;

    const inputs: DocInput[] = [];
    let hadPresenceError = false;
    for (let i = 0; i < rows.length; i++) {
      try {
        inputs.push(await collect(rows[i]!, i === 0));
      } catch (err) {
        rows[i]!.error = err instanceof Error ? err.message : String(err);
        hadPresenceError = true;
      }
    }
    if (hadPresenceError) return;

    const outcome = await onRender(inputs);
    if (outcome.ok) return;

    if (outcome.rowErrors) {
      for (const [index, message] of Object.entries(outcome.rowErrors)) {
        const r = rows[Number(index)];
        if (r) r.error = message;
      }
    }
    if (outcome.oadError) oadError = outcome.oadError;
  }
</script>

<form class="oad-form" novalidate onsubmit={submit}>
  <p class="form-intro">
    Add the documents that make up your OpenAPI Description. The <strong
      >first document is the entry document</strong
    >; any others are additional (referenced) documents. Or <strong>Load folder</strong> to add a
    whole directory at once (relative paths are preserved); supply a base URL to map the folder onto
    a server path instead of the implicit <code>file://</code> base. Every document must be a
    complete OpenAPI 3.1 or 3.2 document, and all documents must share the same version.
  </p>

  <div class="rows">
    {#each rows as row, i (row.id)}
      <fieldset class="doc-row" class:has-error={row.error}>
        <div class="row-top">
          <span class="row-role" class:is-entry={i === 0}>{roleLabel(i)}</span>
          {#if row.preloaded}
            <span class="file-name" title="path within the folder">{row.preloaded.relativePath}</span>
          {:else}
            <div class="source-toggle" role="radiogroup" aria-label="Document source">
              <label>
                <input type="radio" name={`src-${row.id}`} class="src" value="upload" bind:group={row.source} />
                Upload
              </label>
              <label>
                <input type="radio" name={`src-${row.id}`} class="src" value="url" bind:group={row.source} />
                URL
              </label>
            </div>
          {/if}
          <div class="row-actions">
            <button
              type="button"
              class="make-entry"
              title="Make this the entry document"
              hidden={i === 0}
              onclick={() => makeEntry(row)}>Make entry</button
            >
            <button
              type="button"
              class="remove"
              title="Remove document"
              disabled={!removable}
              style:visibility={removable ? "visible" : "hidden"}
              onclick={() => removeRow(row)}>×</button
            >
          </div>
        </div>

        {#if row.preloaded}
          <div class="upload-fields">
            <input
              type="url"
              class="retrieval"
              aria-label="Retrieval URL (optional — overrides the file:// base)"
              placeholder="Retrieval URL (optional — overrides the file:// base)"
              bind:value={row.retrievalUri}
            />
          </div>
        {:else}
          <div class="upload-fields" hidden={row.source === "url"}>
            <input
              type="file"
              class="file"
              aria-label="OpenAPI document file to upload"
              accept=".json,.yaml,.yml,application/json,text/yaml"
              bind:files={row.files}
            />
            <input
              type="url"
              class="retrieval"
              aria-label="Retrieval URL (optional — base URI this file came from)"
              placeholder="Retrieval URL (optional — base URI this file came from)"
              bind:value={row.retrievalUri}
            />
          </div>
          <div class="url-fields" hidden={row.source !== "url"}>
            <input
              type="url"
              class="url"
              aria-label="Document URL to fetch"
              placeholder="https://example.com/openapi.yaml"
              bind:value={row.url}
            />
          </div>
        {/if}
        <p class="row-error" hidden={!row.error}>{row.error}</p>
      </fieldset>
    {/each}
  </div>

  <div class="form-actions">
    <button type="button" class="add-row" onclick={addRow}>+ Add document</button>
    <button type="button" class="add-folder" onclick={() => folderInputEl.click()}>Load folder…</button>
    <input
      type="url"
      class="folder-base"
      aria-label="Base URL for the folder (optional)"
      placeholder="Base URL for the folder (optional)"
      bind:value={folderBase}
    />
    <input
      type="file"
      class="folder-input"
      multiple
      hidden
      bind:this={folderInputEl}
      onchange={onFolderChange}
      {...{ webkitdirectory: true }}
    />
    <button type="submit" class="render">Render OAD</button>
  </div>

  <p class="oad-error" hidden={!oadError}>{oadError}</p>
</form>
