// A flat, self-describing model of everything wrong with an OAD after it renders — unresolved
// references and unreachable documents — plus a plain-text formatter. The text form names
// documents, JSON Pointers, and reasons without any reliance on color or icons, so it can be
// pasted to a maintainer who can't see the diagram.

import type { Oad, OadDocument } from "../types";
import type { DiagnosticCode, ReferenceEdge, RefKind, ResolvedRefs } from "../refs/types";
import { displayPointer } from "../model/jsonPointer";
import { docLabel } from "../app/bootstrap";

export type IssueSeverity = "error" | "warning";

/** An unresolved (or mis-resolved) reference. */
export interface RefIssue {
  severity: IssueSeverity;
  status: "broken" | "external" | "type-mismatch";
  /** Which reference field (selects the human label in the text report). */
  kind?: RefKind;
  sourceDoc: string;
  sourcePointer: string;
  refString: string;
  detail: string;
}

/** A semantic advisory on a reference that *did* resolve (operation-target / Path Item overlap). */
export interface RefAdvisory {
  severity: IssueSeverity;
  code: DiagnosticCode;
  kind?: RefKind;
  sourceDoc: string;
  sourcePointer: string;
  refString: string;
  detail: string;
}

/** A document-level problem (currently only unreachability). */
export interface DocIssue {
  severity: "warning";
  doc: string;
  detail: string;
}

export interface IssueReport {
  entry: string;
  refIssues: RefIssue[];
  advisories: RefAdvisory[];
  docIssues: DocIssue[];
  total: number;
}

const STATUS_SEVERITY: Record<RefIssue["status"], IssueSeverity> = {
  broken: "error",
  "type-mismatch": "error",
  external: "warning",
};

/** Gather every post-render issue into one report. `unreachable` comes from reachability.ts. */
export function collectIssues(
  oad: Oad,
  refs: ResolvedRefs,
  unreachable: readonly OadDocument[],
): IssueReport {
  const byId = new Map(oad.documents.map((d) => [d.id, d]));
  const label = (id: string): string => docLabel(byId.get(id), id);

  const refIssues: RefIssue[] = [];
  const advisories: RefAdvisory[] = [];
  for (const e of refs.edges) {
    if (e.status !== "resolved") {
      refIssues.push({
        severity: STATUS_SEVERITY[e.status],
        status: e.status,
        kind: e.kind,
        sourceDoc: label(e.sourceDocId),
        sourcePointer: displayPointer(e.sourceObjectId),
        refString: e.refString,
        detail: refDetail(e),
      });
    }
    // A reference can resolve yet still carry advisories (e.g. an operationRef to a webhook).
    for (const d of e.diagnostics ?? []) {
      advisories.push({
        severity: d.severity,
        code: d.code,
        kind: e.kind,
        sourceDoc: label(e.sourceDocId),
        sourcePointer: displayPointer(e.sourceObjectId),
        refString: e.refString,
        detail: d.detail,
      });
    }
  }

  const entryDoc = oad.documents.find((d) => d.isEntry) ?? oad.documents[0];
  const docIssues: DocIssue[] = unreachable.map((d) => ({
    severity: "warning",
    doc: docLabel(d, d.id),
    detail: "not reachable from the entry document",
  }));

  return {
    entry: entryDoc ? docLabel(entryDoc, entryDoc.id) : "(none)",
    refIssues,
    advisories,
    docIssues,
    total: refIssues.length + advisories.length + docIssues.length,
  };
}

function refDetail(e: Pick<ReferenceEdge, "status" | "resolution" | "requiredType" | "targetType" | "refString">): string {
  switch (e.status) {
    case "broken":
      if (e.resolution === "component-name") {
        return `no ${typeName(e.requiredType)} component named "${e.refString}"`;
      }
      if (e.resolution === "operation-id") {
        return `no Operation declares operationId "${e.refString}"`;
      }
      return "target not found (the fragment names nothing)";
    case "external":
      return "external document not loaded";
    case "type-mismatch":
      return `expected ${e.requiredType}, found ${e.targetType ?? "?"}`;
    default:
      return "";
  }
}

/** Human label for a component type (`SecurityScheme` reads as two words). */
function typeName(requiredType: string): string {
  return requiredType === "SecurityScheme" ? "Security Scheme" : requiredType || "target";
}

/** Human label for a reference field, for the plain-text report. */
function refLabel(kind: RefKind | undefined): string {
  switch (kind) {
    case "operationRef":
      return "operationRef";
    case "operationId":
      return "operationId";
    case "discriminatorMapping":
      return "mapping value";
    case "securityRequirement":
      return "security requirement";
    default:
      return "$ref";
  }
}

/** Render the report as plain text suitable for copy-paste to a maintainer. */
export function formatIssueReport(report: IssueReport): string {
  const lines: string[] = ["OAS Structure Viewer — issue report", `Entry document: ${report.entry}`];

  if (report.total === 0) {
    lines.push("", "No issues found.");
    return lines.join("\n");
  }

  if (report.refIssues.length) {
    lines.push("", `Unresolved references (${report.refIssues.length}):`);
    for (const i of report.refIssues) {
      lines.push(`  [${i.status}] ${i.sourceDoc} ${i.sourcePointer}`);
      lines.push(`      ${refLabel(i.kind)}: ${i.refString}`);
      lines.push(`      ${i.detail}`);
    }
  }

  if (report.advisories.length) {
    lines.push("", `Reference advisories (${report.advisories.length}):`);
    for (const a of report.advisories) {
      lines.push(`  [${a.severity}] ${a.sourceDoc} ${a.sourcePointer}`);
      lines.push(`      ${refLabel(a.kind)}: ${a.refString}`);
      lines.push(`      ${a.detail}`);
    }
  }

  if (report.docIssues.length) {
    lines.push("", `Unreachable documents (${report.docIssues.length}):`);
    for (const i of report.docIssues) {
      lines.push(`  ${i.doc} — ${i.detail}`);
    }
  }

  return lines.join("\n");
}
