// Assemble loaded documents into a validated OAD. The entry document is the first one
// (the form guarantees this), so the OAD-level checks are a single OAS version family
// (no 3.1/3.2 mix) and globally-unique Operation `operationId`s.

import type { Oad, OadDocument, TreeNode } from "./types";
import { DuplicateOperationIdError } from "./errors";
import { determineVersionFamily } from "./loader";
import { displayPointer } from "./model/jsonPointer";

export function assembleOad(documents: OadDocument[]): Oad {
  // The OAD's version family comes from its OpenAPI documents (a JSON Schema document has none of its
  // own); a 3.1/3.2 mix throws here. With only JSON Schema documents it defaults to "3.1".
  const { family } = determineVersionFamily(documents);

  assertUniqueOperationIds(documents);

  return { documents, versionFamily: family };
}

/** A site where an `operationId` is declared, for the duplicate-error message. */
interface OperationIdSite {
  doc: OadDocument;
  pointer: string;
}

/**
 * `operationId`s must be unique across the whole OAD, since a Link's `operationId` must
 * identify exactly one Operation. Two Operations sharing one — whether in the same document
 * or split across two loaded documents — makes the OAD ambiguous, so it is rejected before
 * any tree renders (surfaced as an OAD-level error, like a version mismatch). Detecting this
 * here also guarantees the resolver's `operationId` index is unique by construction.
 */
function assertUniqueOperationIds(documents: OadDocument[]): void {
  const byId = new Map<string, OperationIdSite[]>();
  for (const doc of documents) {
    collectOperationIds(doc.root, doc, byId);
  }

  for (const [operationId, sites] of byId) {
    if (sites.length < 2) continue;
    const where = sites.map((s) => `${docLabel(s.doc)} ${displayPointer(s.pointer)}`).join(", ");
    throw new DuplicateOperationIdError(
      `Duplicate operationId "${operationId}": declared on ${sites.length} Operations (${where}). ` +
        `Every operationId must be unique across the OAD.`,
    );
  }
}

/** Record the `operationId` of every Operation Object in a document's tree. */
function collectOperationIds(
  node: TreeNode,
  doc: OadDocument,
  byId: Map<string, OperationIdSite[]>,
): void {
  if (node.oasType === "Operation Object") {
    const field = node.children.find((c) => c.key === "operationId");
    if (field && field.valueKind === "string") {
      const id = field.scalarValue as string;
      const sites = byId.get(id);
      if (sites) sites.push({ doc, pointer: field.id });
      else byId.set(id, [{ doc, pointer: field.id }]);
    }
  }
  for (const child of node.children) collectOperationIds(child, doc, byId);
}

/** Human label for a document in an error message. */
function docLabel(doc: OadDocument): string {
  return doc.filename ?? doc.retrievalUri ?? `(${doc.source} document)`;
}
