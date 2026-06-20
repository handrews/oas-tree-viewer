// App wiring kept as plain, testable TS: runs the load → assemble → resolve pipeline
// for a set of document inputs, and labels documents for the detail panel. App.svelte
// owns the reactive state; this module owns the framework-agnostic logic.

import type { DocInput } from "../loader";
import type { Oad, OadDocument } from "../types";
import type { ResolvedRefs } from "../refs/types";
import { type ViewerConfig, defaultConfig } from "./config";
import { loadDocument } from "../loader";
import { assembleOad } from "../oad";
import { resolveOad } from "../refs/resolver";
import { errorMessage } from "../errors";

/** Outcome of running the pipeline: a rendered OAD, or per-row / OAD-level errors. */
export type PipelineResult =
  | { ok: true; oad: Oad; refs: ResolvedRefs }
  | { ok: false; rowErrors?: Record<number, string>; oadError?: string };

/**
 * Load each input document (reporting per-row presence/parse problems), then assemble
 * and resolve the OAD (reporting an OAD-level error such as a version mismatch).
 */
export async function runPipeline(
  inputs: DocInput[],
  config: ViewerConfig = defaultConfig,
): Promise<PipelineResult> {
  const docs: OadDocument[] = [];
  const rowErrors: Record<number, string> = {};

  for (let i = 0; i < inputs.length; i++) {
    try {
      docs.push(await loadDocument(inputs[i]!));
    } catch (e) {
      rowErrors[i] = errorMessage(e);
    }
  }
  if (Object.keys(rowErrors).length > 0) return { ok: false, rowErrors };

  try {
    const oad = assembleOad(docs);
    const refs = resolveOad(oad, config);
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
