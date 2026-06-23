// App wiring kept as plain, testable TS: runs the load → assemble → resolve pipeline
// for a set of document inputs, and labels documents for the detail panel. App.svelte
// owns the reactive state; this module owns the framework-agnostic logic.

import type { DetectedDoc, DocInput } from "../loader";
import type { Oad, OadDocument, VersionFamily } from "../types";
import type { ResolvedRefs } from "../refs/types";
import { type ViewerConfig, defaultConfig } from "./config";
import { detectDocument, determineVersionFamily, finalizeDocument } from "../loader";
import { assembleOad } from "../oad";
import { resolveOad } from "../refs/resolver";
import { typeFragments, markFragmentEdges } from "../refs/fragments";
import { errorMessage } from "../errors";

/** Outcome of running the pipeline: a rendered OAD, or per-row / OAD-level errors. */
export type PipelineResult =
  | { ok: true; oad: Oad; refs: ResolvedRefs }
  | { ok: false; rowErrors?: Record<number, string>; oadError?: string };

/**
 * Detect each input document (reporting per-row presence/parse problems), fix the OAD's version
 * family from its OpenAPI documents (reporting an OAD-level version mismatch), then finalize
 * (classify + validate) each document and assemble + resolve the OAD. The two phases let a JSON
 * Schema document borrow the version family from an OpenAPI sibling, which is only known once every
 * document has been detected.
 */
export async function runPipeline(
  inputs: DocInput[],
  config: ViewerConfig = defaultConfig,
): Promise<PipelineResult> {
  const detected: DetectedDoc[] = [];
  const rowErrors: Record<number, string> = {};

  for (let i = 0; i < inputs.length; i++) {
    try {
      detected.push(await detectDocument(inputs[i]!, config.allowFragments));
    } catch (e) {
      rowErrors[i] = errorMessage(e);
    }
  }
  if (Object.keys(rowErrors).length > 0) return { ok: false, rowErrors };

  let family: VersionFamily;
  let determined: boolean;
  try {
    ({ family, determined } = determineVersionFamily(detected));
  } catch (e) {
    return { ok: false, oadError: errorMessage(e) };
  }

  const docs: OadDocument[] = [];
  for (let i = 0; i < detected.length; i++) {
    try {
      docs.push(await finalizeDocument(detected[i]!, family, determined));
    } catch (e) {
      rowErrors[i] = errorMessage(e);
    }
  }
  if (Object.keys(rowErrors).length > 0) return { ok: false, rowErrors };

  try {
    const oad = assembleOad(docs);
    // Fragments (if any) are classified from the references that target them; an untyped entry
    // fragment is an OAD-level error. Then a final resolve over the now-classified trees, with the
    // ambiguous-fragment edges marked as type errors.
    const fragmentError = typeFragments(oad, config);
    if (fragmentError) return { ok: false, oadError: fragmentError };
    const refs = resolveOad(oad, config);
    markFragmentEdges(oad, refs);
    return { ok: true, oad, refs };
  } catch (e) {
    return { ok: false, oadError: errorMessage(e) };
  }
}

/** Human label for a document id, used by the detail panel's reference sections. */
export function docLabel(doc: OadDocument | undefined, fallback: string): string {
  if (!doc) return fallback;
  return doc.filename ?? doc.retrievalUri ?? `(${doc.source} document)`;
}
