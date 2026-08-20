// The join between the engine's Diagnostic[] and the tool's wire output — exactly the mapping
// src/render/issues.ts already computes for the drawer, run once here so MCP output and the drawer
// can't drift. `docId` is a process-global counter (src/loader.ts) and must never reach the wire:
// `oad.documents.findIndex` is the only place it is read, to recover a stable `documentIndex`; every
// display string comes from `collectIssues`'s `docLabels`, never from the id itself.
//
// Progress is reported through a plain callback rather than an MCP notification directly, and
// cancellation through a plain AbortSignal, so this module stays MCP-unaware — server.ts is the only
// place that knows about progress tokens or `ctx.mcpReq`. Every step reported is real work this
// module does (materializing documents, running the pipeline, joining the catalog); there is nothing
// here that exists only to produce a progress event.

import type { Oad } from "../types";
import type { Diagnostic } from "../diagnostics/types";
import { runPipeline, type PipelineResult } from "../app/bootstrap";
import { defaultConfig, type ViewerConfig } from "../app/config";
import { FRAGMENTS_LOAD_HINT } from "../app/fragmentsText";
import { demoById, demoInputs } from "../app/demos";
import { diagnosticCatalog, severityFor } from "../diagnostics/catalog";
import {
  collectIssues,
  formatIssueReport,
  issueSections,
  sectionForCode,
  type IssueReport,
} from "../render/issues";
import { displayPointer } from "../model/jsonPointer";
import { demoDocuments, toInputs, type InlineDoc } from "./documents";
import type { McpDeps } from "./ports";
import { diagnosticUri } from "./uris";
import type { AnalyzeInput, AnalyzeOutput } from "./schemas";

/** What a caller has already decided, from an earlier MRTR round — never document payload, just the
 *  two choices these elicitations can produce. `server.ts` is the only module that knows these came
 *  from an elicitation; here they are just optional overrides. */
export interface AnalyzeDecisions {
  /** The filename to treat as the entry document, when `documents[]`'s own `isEntry` flags don't
   *  pick exactly one. */
  entry?: string;
  /** How to load a document that is neither OpenAPI nor JSON Schema, once the caller has been asked. */
  fragments?: ViewerConfig["fragments"];
}

/** One outstanding question `runAnalysis` needs answered before it can proceed — the plain-TS shape
 *  that lets this module report "I need a decision" without importing anything MCP-shaped. */
export type AnalyzeNeed = { kind: "entry"; filenames: string[] } | { kind: "fragments" };

export type AnalyzeResult =
  | { ok: true; structured: AnalyzeOutput; text: string }
  | { ok: false; message: string }
  | { ok: "needs-input"; need: AnalyzeNeed };

/** One progress update: `progress` strictly increases across calls for the same analysis. */
export type ProgressReporter = (
  progress: number,
  total: number,
  message: string,
) => void | Promise<void>;

const SEVERITY_RANK: Record<Diagnostic["severity"], number> = { info: 0, warning: 1, error: 2 };

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Analysis cancelled.");
}

/** Load, resolve, and diagnose the requested document set, then join the result onto the wire shape.
 *  `decisions` carries answers an earlier MRTR round already collected; omit it on a first call. */
export async function runAnalysis(
  deps: McpDeps,
  args: AnalyzeInput,
  signal?: AbortSignal,
  onProgress?: ProgressReporter,
  decisions: AnalyzeDecisions = {},
): Promise<AnalyzeResult> {
  if (args.demo !== undefined && args.documents !== undefined) {
    return { ok: false, message: 'Provide either "demo" or "documents", not both.' };
  }
  if (args.demo === undefined && args.documents === undefined) {
    return { ok: false, message: 'Provide either "demo" or "documents".' };
  }

  // Only inline `documents[]` can be ambiguous — a demo's `isEntry` flags are fixed at authoring time
  // (see src/app/demos.ts) — and only once there is at least one document to choose among. Nothing
  // downstream actually requires exactly one entry (the engine defaults gracefully to "the first
  // flagged document, else the first document"), but a tool answering a machine caller should say
  // which document it analyzed as the entry rather than silently guess.
  let documents = args.documents;
  if (documents !== undefined && documents.length > 0) {
    const entryCount = documents.filter((d) => d.isEntry).length;
    if (entryCount !== 1) {
      if (decisions.entry === undefined) {
        return {
          ok: "needs-input",
          need: { kind: "entry", filenames: documents.map((d) => d.filename) },
        };
      }
      documents = documents.map((d) => ({ ...d, isEntry: d.filename === decisions.entry }));
    }
  }

  // Known upfront for both shapes — a demo's document count is static, an inline set's is just its
  // length — so the total step count (resolve + one read per document + pipeline + catalog join) is
  // known before the first notification, and every `progress` value below is genuinely increasing.
  const docCount = args.demo !== undefined ? demoInputs(args.demo)?.length : documents!.length;
  const total = (docCount ?? 0) + 3;
  let step = 0;
  const notify = async (message: string): Promise<void> => {
    step += 1;
    await onProgress?.(step, total, message);
  };

  await notify(
    args.demo !== undefined
      ? `resolving demo "${args.demo}"`
      : `resolving ${docCount} inline document(s)`,
  );

  const materialized = await materializeDocs(deps, args.demo, documents, signal, notify);
  if (!materialized.ok) return materialized;

  // A demo's own config partial (e.g. "fragment" needs `fragments: "root"` just to load) wins over
  // the caller's override, mirroring ConfigurePage.svelte's `{ ...config, ...demo.config }` — without
  // this, the fragment demos would fail to load through this tool at all. An answered fragment-consent
  // elicitation wins over both: it is what the caller just told this specific call to do.
  const demoConfig = args.demo !== undefined ? demoById(args.demo)?.config : undefined;
  const config: ViewerConfig = {
    ...defaultConfig,
    ...args.config,
    ...demoConfig,
    ...(decisions.fragments !== undefined ? { fragments: decisions.fragments } : {}),
  };

  checkAborted(signal);
  await notify("running load → validate → resolve → diagnose");
  const result = await runPipeline(toInputs(materialized.docs), config);
  if (!result.ok) {
    if (decisions.fragments === undefined && needsFragmentConsent(result, config)) {
      return { ok: "needs-input", need: { kind: "fragments" } };
    }
    return { ok: false, message: pipelineErrorMessage(result) };
  }

  const filtered = result.diagnostics.filter(
    (d) => SEVERITY_RANK[d.severity] >= SEVERITY_RANK[args.minSeverity],
  );
  await notify(`collecting ${filtered.length} diagnostics`);
  const report = collectIssues(result.oad, filtered);
  return {
    ok: true,
    structured: toStructured(result.oad, report),
    text: formatIssueReport(report),
  };
}

/** Materialize `demo` xor `documents` into InlineDoc[], reporting one step per document read. */
async function materializeDocs(
  deps: McpDeps,
  demo: string | undefined,
  documents: InlineDoc[] | undefined,
  signal: AbortSignal | undefined,
  notify: (message: string) => Promise<void>,
): Promise<{ ok: true; docs: InlineDoc[] } | { ok: false; message: string }> {
  const reportRead = async (doc: InlineDoc): Promise<void> => {
    checkAborted(signal);
    await notify(`read ${doc.filename} (${byteLength(doc.text).toLocaleString()} bytes)`);
  };

  if (demo !== undefined) {
    const docs = await demoDocuments(demo, deps.fixtures, signal, reportRead);
    if (!docs) return { ok: false, message: `Unknown demo "${demo}".` };
    return { ok: true, docs };
  }

  const docs = documents!;
  for (const doc of docs) await reportRead(doc);
  return { ok: true, docs };
}

/** A readable message for a blocked load — a typed OAD-level error, or a per-document one. */
function pipelineErrorMessage(result: Extract<PipelineResult, { ok: false }>): string {
  if (result.oadError) return result.oadError;
  if (result.rowErrors) {
    const lines = Object.entries(result.rowErrors).map(([i, msg]) => `  document ${i}: ${msg}`);
    return `Could not load the document set:\n${lines.join("\n")}`;
  }
  return "Could not load the document set.";
}

/** Whether a failed pipeline run is specifically the fragment-consent case. Requires EVERY row error
 *  to be the fragment one, not just one of several: if another document failed for an unrelated
 *  reason, enabling fragments would not actually fix the load, so asking for consent would just cost
 *  a round trip before the caller hits that other error anyway. `runPipeline` converts every
 *  per-document error to a plain string (`rowErrors`), discarding the error's type, so matching
 *  `FRAGMENTS_LOAD_HINT` — the exact tail `NotOpenApiError` ends with (src/loader.ts's `detectKind`)
 *  — is the one stable signal exposed for this condition without changing the engine. */
function needsFragmentConsent(
  result: Extract<PipelineResult, { ok: false }>,
  config: ViewerConfig,
): boolean {
  return (
    config.fragments === "none" &&
    result.rowErrors !== undefined &&
    Object.values(result.rowErrors).every((msg) => msg.endsWith(FRAGMENTS_LOAD_HINT))
  );
}

/** The one join from the engine's model to the wire shape (see file header). */
function toStructured(oad: Oad, report: IssueReport): AnalyzeOutput {
  const catalog = diagnosticCatalog();

  const documents = oad.documents.map((d, index) => ({
    index,
    label: report.docLabels[d.id],
    kind: d.kind,
    oasVersion: d.oasVersion,
    isEntry: d.isEntry,
  }));

  const location = (loc: Diagnostic["location"]) => ({
    documentIndex: oad.documents.findIndex((d) => d.id === loc.docId),
    document: report.docLabels[loc.docId],
    pointer: loc.pointer,
    displayPointer: displayPointer(loc.pointer),
    line: loc.range?.start.line,
    column: loc.range?.start.col,
  });

  const diagnostics = report.diagnostics.map((d) => ({
    code: d.code,
    title: catalog[d.code].title,
    severity: d.severity,
    defaultSeverity: severityFor(d.code),
    source: d.source,
    section: sectionForCode(d.code),
    message: d.message,
    location: location(d.location),
    relatedLocations: d.relatedLocations?.map(location),
    ref: d.ref,
    catalogUri: diagnosticUri(d.code),
  }));

  return {
    entry: report.entry,
    versionFamily: oad.versionFamily,
    documents,
    counts: {
      total: report.total,
      error: report.diagnostics.filter((d) => d.severity === "error").length,
      warning: report.diagnostics.filter((d) => d.severity === "warning").length,
      info: report.diagnostics.filter((d) => d.severity === "info").length,
    },
    sections: issueSections(report).map((s) => ({
      id: s.id,
      label: s.label,
      count: s.items.length,
    })),
    diagnostics,
  };
}
