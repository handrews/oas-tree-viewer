// Test builders that exercise the real pipeline: text -> loadDocument (parse + validate +
// buildTree + classify) -> assembleOad. Used by resolver/detail-panel specs so the tests
// run over genuinely classified trees rather than hand-built fixtures.

import {
  detectDocument,
  determineVersionFamily,
  finalizeDocument,
  loadDocument,
  type DocInput,
} from "../src/loader";
import { assembleOad } from "../src/oad";
import type { Oad, OadDocument } from "../src/types";

export interface MakeDocOptions {
  filename?: string;
  relativePath?: string;
  retrievalUri?: string;
  isEntry?: boolean;
}

export function makeInput(yaml: string, opts: MakeDocOptions = {}): DocInput {
  return {
    source: "upload",
    filename: opts.filename ?? "doc.yaml",
    text: yaml,
    relativePath: opts.relativePath,
    retrievalUri: opts.retrievalUri,
    isEntry: opts.isEntry ?? false,
  };
}

export function makeDoc(yaml: string, opts: MakeDocOptions = {}): Promise<OadDocument> {
  return loadDocument(makeInput(yaml, opts));
}

export function makeOad(...docs: OadDocument[]): Oad {
  return assembleOad(docs);
}

/**
 * Run the real two-phase load over several inputs (detect all → fix the version family → finalize
 * all → assemble), so a JSON Schema document borrows the OAS version from an OpenAPI sibling — exactly
 * as the app pipeline does. Use this (not `makeOad` over `makeDoc`s) whenever cross-document version
 * borrowing matters.
 */
export async function loadOad(...inputs: DocInput[]): Promise<Oad> {
  const detected = [];
  for (const input of inputs) detected.push(await detectDocument(input));
  const { family, determined } = determineVersionFamily(detected);
  const docs: OadDocument[] = [];
  for (const d of detected) docs.push(await finalizeDocument(d, family, determined));
  return assembleOad(docs);
}
