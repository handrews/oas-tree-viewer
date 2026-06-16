// Test builders that exercise the real pipeline: text -> loadDocument (parse + validate +
// buildTree + classify) -> assembleOad. Used by resolver/detail-panel specs so the tests
// run over genuinely classified trees rather than hand-built fixtures.

import { loadDocument } from "../src/loader";
import { assembleOad } from "../src/oad";
import type { Oad, OadDocument } from "../src/types";

export interface MakeDocOptions {
  filename?: string;
  retrievalUri?: string;
  isEntry?: boolean;
}

export function makeDoc(yaml: string, opts: MakeDocOptions = {}): Promise<OadDocument> {
  return loadDocument({
    source: "upload",
    filename: opts.filename ?? "doc.yaml",
    text: yaml,
    retrievalUri: opts.retrievalUri,
    isEntry: opts.isEntry ?? false,
  });
}

export function makeOad(...docs: OadDocument[]): Oad {
  return assembleOad(docs);
}
