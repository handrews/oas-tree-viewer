// The join between the engine's Diagnostic[] and the tool's wire output — exactly the mapping
// src/render/issues.ts already computes for the drawer, run once here so MCP output and the drawer
// can't drift. `docId` is a process-global counter (src/loader.ts) and must never reach the wire:
// `oad.documents.findIndex` is the only place it is read, to recover a stable `documentIndex`; every
// display string comes from `collectIssues`'s `docLabels`, never from the id itself.

import type { Oad } from "../types";
import type { Diagnostic } from "../diagnostics/types";
import type { DocInput } from "../loader";
import { runPipeline, type PipelineResult } from "../app/bootstrap";
import { defaultConfig, type ViewerConfig } from "../app/config";
import { demoById } from "../app/demos";
import { diagnosticCatalog, severityFor } from "../diagnostics/catalog";
import {
  collectIssues,
  formatIssueReport,
  issueSections,
  sectionForCode,
  type IssueReport,
} from "../render/issues";
import { displayPointer } from "../model/jsonPointer";
import { demoDocuments, toInputs } from "./documents";
import type { McpDeps } from "./ports";
import { diagnosticUri } from "./uris";
import type { AnalyzeInput, AnalyzeOutput } from "./schemas";

export type AnalyzeResult =
  | { ok: true; structured: AnalyzeOutput; text: string }
  | { ok: false; message: string };

const SEVERITY_RANK: Record<Diagnostic["severity"], number> = { info: 0, warning: 1, error: 2 };

/** Load, resolve, and diagnose the requested document set, then join the result onto the wire shape. */
export async function runAnalysis(
  deps: McpDeps,
  args: AnalyzeInput,
  signal?: AbortSignal,
): Promise<AnalyzeResult> {
  const inputs = await resolveInputs(deps, args, signal);
  if (!inputs.ok) return inputs;

  // A demo's own config partial (e.g. "fragment" needs `fragments: "root"` just to load) wins over
  // the caller's override, mirroring ConfigurePage.svelte's `{ ...config, ...demo.config }` — without
  // this, the fragment demos would fail to load through this tool at all.
  const demoConfig = args.demo !== undefined ? demoById(args.demo)?.config : undefined;
  const config: ViewerConfig = { ...defaultConfig, ...args.config, ...demoConfig };
  const result = await runPipeline(inputs.value, config);
  if (!result.ok) return { ok: false, message: pipelineErrorMessage(result) };

  const filtered = result.diagnostics.filter(
    (d) => SEVERITY_RANK[d.severity] >= SEVERITY_RANK[args.minSeverity],
  );
  const report = collectIssues(result.oad, filtered);
  return {
    ok: true,
    structured: toStructured(result.oad, report),
    text: formatIssueReport(report),
  };
}

/** Resolve `demo` xor `documents` into pipeline input, or a message explaining why neither applies. */
async function resolveInputs(
  deps: McpDeps,
  args: AnalyzeInput,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; value: DocInput[] } | { ok: false; message: string }> {
  if (args.demo !== undefined && args.documents !== undefined) {
    return { ok: false, message: 'Provide either "demo" or "documents", not both.' };
  }
  if (args.demo !== undefined) {
    const docs = await demoDocuments(args.demo, deps.fixtures, signal);
    if (!docs) return { ok: false, message: `Unknown demo "${args.demo}".` };
    return { ok: true, value: toInputs(docs) };
  }
  if (args.documents !== undefined) {
    return { ok: true, value: toInputs(args.documents) };
  }
  return { ok: false, message: 'Provide either "demo" or "documents".' };
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
