// Reads a drag-and-drop DataTransfer (or a directory <input>'s FileList) into named
// files. Uses the widely-supported FileSystem Entry API so a dropped *folder* can be
// walked recursively. Browser-only (no jsdom equivalent), so it's verified in-browser
// rather than unit-tested; the pure shaping lives in ./oadForm.

/** A file read to text, with its path relative to the dropped/selected folder. */
export interface NamedFile {
  filename: string;
  relativePath: string;
  text: string;
}

/** A single dropped file, or a dropped directory walked into its files (paths relative
 *  to the folder, matching `webkitRelativePath`: `folder/sub/file.yaml`). */
export type DroppedLocal =
  | { kind: "file"; file: File }
  | { kind: "dir"; folderName: string; files: { relativePath: string; file: File }[] };

/** Interpret a drop as a single file or a directory bundle (null if it carries neither). */
export async function readDrop(dt: DataTransfer): Promise<DroppedLocal | null> {
  const entries = [...dt.items]
    .filter((it) => it.kind === "file")
    .map((it) => it.webkitGetAsEntry?.() ?? null)
    .filter((e): e is FileSystemEntry => e != null);

  if (entries.length === 0) {
    const file = dt.files[0];
    return file ? { kind: "file", file } : null;
  }

  const first = entries[0]!;
  if (first.isDirectory) {
    const dir = first as FileSystemDirectoryEntry;
    return { kind: "dir", folderName: dir.name, files: await walkDirectory(dir, dir.name) };
  }
  return { kind: "file", file: await entryFile(first as FileSystemFileEntry) };
}

/** Read each file's text. For a directory drop, paths are kept folder-relative. */
export async function readDropped(dropped: DroppedLocal): Promise<NamedFile[]> {
  if (dropped.kind === "file") {
    return [
      {
        filename: dropped.file.name,
        relativePath: dropped.file.name,
        text: await dropped.file.text(),
      },
    ];
  }
  return Promise.all(
    dropped.files.map(async ({ relativePath, file }) => ({
      filename: file.name,
      relativePath,
      text: await file.text(),
    })),
  );
}

/** Read a directory <input>'s files (each File carries `webkitRelativePath`). */
export function namedFilesFromList(files: File[]): Promise<NamedFile[]> {
  return Promise.all(
    files.map(async (f) => ({
      filename: f.name,
      relativePath: f.webkitRelativePath || f.name,
      text: await f.text(),
    })),
  );
}

async function walkDirectory(
  dir: FileSystemDirectoryEntry,
  prefix: string,
): Promise<{ relativePath: string; file: File }[]> {
  const out: { relativePath: string; file: File }[] = [];
  for (const entry of await readEntries(dir)) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory) {
      out.push(...(await walkDirectory(entry as FileSystemDirectoryEntry, path)));
    } else {
      out.push({ relativePath: path, file: await entryFile(entry as FileSystemFileEntry) });
    }
  }
  return out;
}

// readEntries returns directory contents in batches; call until it yields an empty one.
async function readEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
