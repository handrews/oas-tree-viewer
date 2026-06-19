<script lang="ts">
  // Multi-document OAD input form. Each row is one source: a local file OR a local
  // directory (bundle), and/or a URL. A file's URL is its retrieval/base URI; a URL with
  // no local file is fetched. A directory expands into one document per file at submit,
  // with the entry chosen by a picker (only the first row holds the OAD entry). The pure
  // bits (row → DocInput[], folder shaping, labels) live in ./oadForm.
  import type { DocInput } from "../loader";
  import {
    rowToInputs,
    urlFieldLabel,
    dirLocalSource,
    type LocalSource,
    type RenderOutcome,
  } from "./oadForm";
  import { readDrop, readDropped, namedFilesFromList } from "./fileDrop";

  let { onRender }: { onRender: (inputs: DocInput[]) => Promise<RenderOutcome> } = $props();

  interface RowState {
    id: number;
    local: LocalSource;
    url: string;
    error: string | null;
  }

  let nextId = 1;
  const newRow = (): RowState => ({ id: nextId++, local: { kind: "none" }, url: "", error: null });

  let rows = $state<RowState[]>([newRow()]);
  let oadError = $state<string | null>(null);
  let dragId = $state<number | null>(null);

  // Open the hidden file/folder input that lives in the same row as the clicked button
  // (keeps the visible buttons keyboard-focusable, unlike a label over a hidden input).
  function pick(e: MouseEvent, selector: string): void {
    const zone = (e.currentTarget as HTMLElement).closest(".local-source");
    (zone?.querySelector(selector) as HTMLInputElement | null)?.click();
  }

  const removable = $derived(rows.length > 1);
  const roleLabel = (i: number): string => (i === 0 ? "Entry document" : `Additional document ${i}`);

  function addRow(): void {
    rows = [...rows, newRow()];
  }
  function removeRow(row: RowState): void {
    rows = rows.filter((r) => r !== row);
  }
  function makeEntry(row: RowState): void {
    rows = [row, ...rows.filter((r) => r !== row)];
  }
  function clearLocal(row: RowState): void {
    row.local = { kind: "none" };
    row.error = null;
  }

  async function onFileChange(row: RowState, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ""; // allow re-selecting the same file
    if (!file) return;
    row.error = null;
    row.local = { kind: "file", filename: file.name, text: await file.text() };
  }

  async function loadDir(row: RowState, files: { filename: string; relativePath: string; text: string }[]): Promise<void> {
    const dir = dirLocalSource(files);
    if (dir.docs.length === 0) {
      row.error = "No OpenAPI documents (.json/.yaml) found in that folder.";
      return;
    }
    row.error = null;
    row.local = dir;
  }

  async function onFolderChange(row: RowState, input: HTMLInputElement): Promise<void> {
    // Snapshot first: input.files is a live FileList that `input.value = ""` empties in
    // place, so reading it after the reset (to allow re-picking the same folder) would
    // see nothing. Copying the File refs into an array keeps the selection.
    const files = [...(input.files ?? [])];
    input.value = ""; // allow re-selecting the same folder
    if (files.length === 0) return;
    await loadDir(row, await namedFilesFromList(files));
  }

  async function onDrop(row: RowState, e: DragEvent): Promise<void> {
    e.preventDefault();
    dragId = null;
    if (!e.dataTransfer) return;
    const dropped = await readDrop(e.dataTransfer);
    if (!dropped) return;
    if (dropped.kind === "file") {
      row.error = null;
      row.local = { kind: "file", filename: dropped.file.name, text: await dropped.file.text() };
    } else {
      await loadDir(row, await readDropped(dropped));
    }
  }

  function setEntry(row: RowState, index: number): void {
    if (row.local.kind === "dir") row.local = { ...row.local, entryIndex: index };
  }

  async function submit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    oadError = null;
    for (const r of rows) r.error = null;

    const inputs: DocInput[] = [];
    const owners: number[] = []; // rowId for each flattened input, for error attribution
    let hadError = false;
    for (let i = 0; i < rows.length; i++) {
      const res = rowToInputs(rows[i]!.local, rows[i]!.url, i === 0);
      if ("error" in res) {
        rows[i]!.error = res.error;
        hadError = true;
      } else {
        for (const inp of res.inputs) {
          inputs.push(inp);
          owners.push(rows[i]!.id);
        }
      }
    }
    if (hadError) return;

    const outcome = await onRender(inputs);
    if (outcome.ok) return;

    if (outcome.rowErrors) {
      const byRow = new Map<number, string[]>();
      for (const [idx, message] of Object.entries(outcome.rowErrors)) {
        const rowId = owners[Number(idx)];
        if (rowId != null) byRow.set(rowId, [...(byRow.get(rowId) ?? []), message]);
      }
      for (const r of rows) {
        const msgs = byRow.get(r.id);
        if (msgs) r.error = msgs.join(" ");
      }
    }
    if (outcome.oadError) oadError = outcome.oadError;
  }
</script>

<form class="oad-form" novalidate onsubmit={submit}>
  <div class="rows">
    {#each rows as row, i (row.id)}
      <fieldset class="doc-row" class:has-error={row.error}>
        <div class="row-top">
          <span class="row-role" class:is-entry={i === 0}>{roleLabel(i)}</span>
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

        <div
          class="local-source"
          class:dragging={dragId === row.id}
          role="group"
          aria-label="Local file or folder"
          ondragover={(e) => {
            e.preventDefault();
            dragId = row.id;
          }}
          ondragleave={() => (dragId = dragId === row.id ? null : dragId)}
          ondrop={(e) => onDrop(row, e)}
        >
          {#if row.local.kind === "none"}
            <span class="drop-hint">Drop a file or folder, or</span>
            <button type="button" class="choose-file" onclick={(e) => pick(e, "input.file")}
              >Choose file…</button
            >
            <button type="button" class="choose-folder" onclick={(e) => pick(e, "input.folder-input")}
              >Choose folder…</button
            >
            <input
              type="file"
              class="file"
              hidden
              accept=".json,.yaml,.yml,application/json,text/yaml"
              onchange={(e) => onFileChange(row, e.currentTarget)}
            />
            <input
              type="file"
              class="folder-input"
              hidden
              onchange={(e) => onFolderChange(row, e.currentTarget)}
              {...{ webkitdirectory: true }}
            />
          {:else if row.local.kind === "file"}
            <span class="file-name" title={row.local.filename}>{row.local.filename}</span>
            <button type="button" class="clear-local" title="Remove file" onclick={() => clearLocal(row)}>×</button>
          {:else}
            {@const dir = row.local}
            <div class="dir-summary">
              <span class="folder-name" title={dir.folderName}>{dir.folderName}/</span>
              <span class="dir-count">{dir.docs.length} document{dir.docs.length === 1 ? "" : "s"}</span>
              <button type="button" class="clear-local" title="Remove folder" onclick={() => clearLocal(row)}>×</button>
            </div>
            {#if i === 0}
              <label class="entry-pick">
                Entry document
                <select
                  class="entry-select"
                  onchange={(e) => setEntry(row, Number(e.currentTarget.value))}
                >
                  {#each dir.docs as doc, di (doc.relativePath)}
                    <option value={di} selected={di === dir.entryIndex}>{doc.relativePath}</option>
                  {/each}
                </select>
              </label>
            {/if}
            <details class="bundle">
              <summary>Documents in this folder</summary>
              <ul class="bundle-list">
                {#each dir.docs as doc, di (doc.relativePath)}
                  <li class:is-entry-doc={i === 0 && di === dir.entryIndex}>{doc.relativePath}</li>
                {/each}
              </ul>
            </details>
          {/if}
        </div>

        <input
          type="url"
          class="url"
          aria-label={urlFieldLabel(row.local.kind)}
          placeholder={urlFieldLabel(row.local.kind)}
          bind:value={row.url}
        />

        <p class="row-error" hidden={!row.error}>{row.error}</p>
      </fieldset>
    {/each}
  </div>

  <div class="form-actions">
    <button type="button" class="add-row" onclick={addRow}>+ Add document</button>
    <button type="submit" class="render">Render OAD</button>
  </div>

  <p class="oad-error" hidden={!oadError}>{oadError}</p>
</form>
