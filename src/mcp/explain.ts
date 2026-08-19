// Look up one diagnostic code in the catalog (content/diagnostics.yaml) — the same source the issue
// report and analyze-document's `title`/`defaultSeverity` fields already read.

import type { DiagnosticCode } from "../diagnostics/types";
import { diagnosticCatalog, severityFor } from "../diagnostics/catalog";
import { sectionForCode } from "../render/issues";
import { diagnosticUri } from "./uris";
import type { ExplainOutput } from "./schemas";

export function explainCode(code: DiagnosticCode): ExplainOutput {
  const entry = diagnosticCatalog()[code];
  const defaultSeverity = severityFor(code);
  return {
    code,
    title: entry.title,
    description: entry.description,
    defaultSeverity,
    enabled: defaultSeverity !== "off",
    section: sectionForCode(code),
    catalogUri: diagnosticUri(code),
  };
}
