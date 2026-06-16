// Assemble loaded documents into a validated OAD. The entry document is the first one
// (the form guarantees this), so the only OAD-level check left is a single OAS version
// family — no 3.1/3.2 mix.

import type { Oad, OadDocument } from "./types";
import { VersionMismatchError } from "./errors";
import { versionFamilyOf } from "./loader";

export function assembleOad(documents: OadDocument[]): Oad {
  const families = new Set(documents.map((d) => versionFamilyOf(d.oasVersion)));
  if (families.size > 1) {
    throw new VersionMismatchError(
      "This OAD mixes OAS 3.1 and 3.2 documents, which is not supported. Use a single version family.",
    );
  }

  // documents[0] is the entry document by construction.
  const versionFamily = versionFamilyOf(documents[0]!.oasVersion);
  return { documents, versionFamily };
}
