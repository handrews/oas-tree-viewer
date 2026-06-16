// Assemble loaded documents into a validated OAD: exactly one entry document and a
// single OAS version family (no 3.1/3.2 mix). Orders the entry document first.

import type { Oad, OadDocument } from "./types";
import { MultipleEntryError, NoEntryError, VersionMismatchError } from "./errors";
import { versionFamilyOf } from "./loader";

export function assembleOad(documents: OadDocument[]): Oad {
  const entries = documents.filter((d) => d.isEntry);
  if (entries.length === 0) {
    throw new NoEntryError("No entry document selected — mark exactly one document as the entry.");
  }
  if (entries.length > 1) {
    throw new MultipleEntryError(
      `${entries.length} documents are marked as the entry document — choose exactly one.`,
    );
  }

  const families = new Set(documents.map((d) => versionFamilyOf(d.oasVersion)));
  if (families.size > 1) {
    throw new VersionMismatchError(
      "This OAD mixes OAS 3.1 and 3.2 documents, which is not supported. Use a single version family.",
    );
  }
  const versionFamily = entries[0]!.oasVersion.startsWith("3.2") ? "3.2" : "3.1";

  // Entry document first, remaining documents in their given order.
  const ordered = [...documents].sort(
    (a, b) => Number(b.isEntry) - Number(a.isEntry),
  );

  return { documents: ordered, versionFamily };
}
