// The post-render issue report, derived from the unified Diagnostic[] (src/diagnostics). It groups the
// diagnostics into the report's display sections — one grouping (issueSections) shared by the drawer
// component and the plain-text formatter so they can't drift — plus a copy-paste text form that names
// documents, JSON Pointers, and reasons without any reliance on color or icons.

import type { Oad, OadDocument } from "../types";
import type { RefKind, ResolvedRefs } from "../refs/types";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/types";
import { buildDiagnostics } from "../diagnostics/runner";
import { displayPointer } from "../model/jsonPointer";
import { docLabel } from "../app/bootstrap";

export interface IssueReport {
  entry: string;
  diagnostics: Diagnostic[];
  /** docId → display label, so each diagnostic's location can be named. */
  docLabels: Record<string, string>;
  total: number;
}

/** Gather every post-render finding into one report. `unreachable` comes from reachability.ts. */
export function collectIssues(
  oad: Oad,
  refs: ResolvedRefs,
  unreachable: readonly OadDocument[],
): IssueReport {
  const diagnostics = buildDiagnostics(oad, refs, unreachable);
  const docLabels: Record<string, string> = {};
  for (const d of oad.documents) docLabels[d.id] = docLabel(d, d.id);
  const entryDoc = oad.documents.find((d) => d.isEntry) ?? oad.documents[0];
  return {
    entry: entryDoc ? docLabels[entryDoc.id] : "(none)",
    diagnostics,
    docLabels,
    total: diagnostics.length,
  };
}

// ── display grouping ────────────────────────────────────────────────────────

export type SectionId = "unresolved" | "advisories" | "caveats" | "unreachable" | "unvalidated";

/** Which report section each diagnostic code belongs to. */
const SECTION: Record<DiagnosticCode, SectionId> = {
  "ref-broken": "unresolved",
  "ref-type-mismatch": "unresolved",
  "ref-external": "unresolved",
  "pathitem-field-overlap": "advisories",
  "operation-target-webhook": "advisories",
  "operation-target-callback": "advisories",
  "operation-target-ambiguous": "advisories",
  "operation-target-fragile": "advisories",
  "operation-target-no-path": "advisories",
  "ignored-ref-siblings": "caveats",
  "invalid-id-fragment": "caveats",
  "dialect-resolution-unsupported": "caveats",
  "document-unreachable": "unreachable",
  "schema-unvalidated": "unvalidated",
};

const SECTION_ORDER: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "unresolved", label: "Unresolved references" },
  { id: "advisories", label: "Reference advisories" },
  { id: "caveats", label: "Reference-resolution advisories" },
  { id: "unreachable", label: "Unreachable documents" },
  { id: "unvalidated", label: "Unvalidated Schema Objects" },
];

/** The badge shown for an unresolved-reference diagnostic (the old resolve "status"). */
const STATUS_LABEL: Partial<Record<DiagnosticCode, string>> = {
  "ref-broken": "broken",
  "ref-type-mismatch": "type-mismatch",
  "ref-external": "external",
};

/** One report row, with everything the drawer and the text formatter need to render it. */
export interface IssueItemView {
  key: string;
  /** Badge text: a resolve status, a severity, or a document-level kind. */
  badge: string;
  /** CSS class suffix for the badge color. */
  badgeClass: string;
  doc: string;
  /** Display JSON Pointer, or "" for a document-level finding (no pointer shown). */
  pointer: string;
  /** Reference field label (e.g. "operationRef"), present for reference findings. */
  fieldLabel?: string;
  refString?: string;
  message: string;
}

export interface IssueSection {
  id: SectionId;
  label: string;
  items: IssueItemView[];
}

/** Group a report's diagnostics into ordered, non-empty display sections. */
export function issueSections(report: IssueReport): IssueSection[] {
  const buckets = new Map<SectionId, IssueItemView[]>();
  report.diagnostics.forEach((d, idx) => {
    const section = SECTION[d.code];
    const items = buckets.get(section) ?? [];
    items.push(itemFor(d, section, report.docLabels, idx));
    buckets.set(section, items);
  });
  const out: IssueSection[] = [];
  for (const { id, label } of SECTION_ORDER) {
    const items = buckets.get(id);
    if (items?.length) out.push({ id, label, items });
  }
  return out;
}

function itemFor(
  d: Diagnostic,
  section: SectionId,
  docLabels: Record<string, string>,
  idx: number,
): IssueItemView {
  const doc = docLabels[d.location.docId] ?? d.location.docId;
  const key = `${d.location.docId}:${d.location.pointer}:${d.code}:${idx}`;
  switch (section) {
    case "unresolved": {
      const status = STATUS_LABEL[d.code]!; // ref-broken / -type-mismatch / -external
      return {
        key,
        badge: status,
        badgeClass: `status-${status}`,
        doc,
        pointer: displayPointer(d.location.pointer),
        fieldLabel: refLabel(d.ref?.kind),
        refString: d.ref?.refString,
        message: d.message,
      };
    }
    case "advisories":
      return {
        key,
        badge: d.severity,
        badgeClass: `severity-${d.severity}`,
        doc,
        pointer: displayPointer(d.location.pointer),
        fieldLabel: refLabel(d.ref?.kind),
        refString: d.ref?.refString,
        message: d.message,
      };
    case "caveats":
      return {
        key,
        badge: d.severity,
        badgeClass: `severity-${d.severity}`,
        doc,
        pointer: displayPointer(d.location.pointer),
        message: d.message,
      };
    case "unreachable":
    case "unvalidated":
      return {
        key,
        badge: section === "unreachable" ? "unreachable" : "unvalidated",
        badgeClass: "status-unreachable",
        doc,
        pointer: "",
        message: d.message,
      };
  }
}

/** Human label for a reference field, for the report. */
function refLabel(kind: RefKind | undefined): string {
  switch (kind) {
    case "operationRef":
      return "operationRef";
    case "operationId":
      return "operationId";
    case "$dynamicRef":
      return "$dynamicRef";
    case "$recursiveRef":
      return "$recursiveRef";
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
  const lines: string[] = [
    "OAS Structure Viewer — issue report",
    `Entry document: ${report.entry}`,
  ];

  if (report.total === 0) {
    lines.push("", "No issues found.");
    return lines.join("\n");
  }

  for (const section of issueSections(report)) {
    lines.push("", `${section.label} (${section.items.length}):`);
    for (const item of section.items) {
      if (section.id === "unreachable" || section.id === "unvalidated") {
        lines.push(`  ${item.doc} — ${item.message}`);
        continue;
      }
      lines.push(`  [${item.badge}] ${item.doc} ${item.pointer}`);
      if (item.fieldLabel !== undefined && item.refString !== undefined) {
        lines.push(`      ${item.fieldLabel}: ${item.refString}`);
      }
      lines.push(`      ${item.message}`);
    }
  }

  return lines.join("\n");
}
