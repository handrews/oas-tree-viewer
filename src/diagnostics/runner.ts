// The diagnostic runner: turns a resolved OAD into one flat, located Diagnostic[]. It collects (never
// throws) from every non-blocking source the viewer already computes — reference resolution status,
// reference advisories, node-level resolution caveats, and document-level findings — into the single
// unified model, stamping each code's severity from the catalog policy. Pure and node-testable; runs
// in the pipeline worker so only plain data crosses back to the UI.
//
// Edges stay primary: a reference's resolved target is the structural truth (drawn as an arc); the
// diagnostics here are *derived* from edges (and tree nodes), located at the source, with the target
// recorded as a related location — they do not re-encode the edge graph.

import type { Oad, OadDocument, TreeNode } from "../types";
import type { ReferenceEdge, RefStatus, ResolvedRefs } from "../refs/types";
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticLocation,
  DiagnosticRef,
  DiagnosticSource,
} from "./types";
import { emittedSeverity, severityFor } from "./catalog";

const STATUS_CODE: Record<Exclude<RefStatus, "resolved">, DiagnosticCode> = {
  broken: "ref-broken",
  "type-mismatch": "ref-type-mismatch",
  external: "ref-external",
};

/** Collect every non-blocking finding about a resolved OAD into one located, severity-stamped list. */
export function buildDiagnostics(
  oad: Oad,
  refs: ResolvedRefs,
  unreachable: readonly OadDocument[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const emit = (
    code: DiagnosticCode,
    source: DiagnosticSource,
    message: string,
    location: DiagnosticLocation,
    extra?: { relatedLocations?: DiagnosticLocation[]; ref?: DiagnosticRef },
  ): void => {
    const severity = emittedSeverity(severityFor(code));
    if (severity === null) return; // policed to "off"
    out.push({ code, severity, source, message, location, ...extra });
  };

  // ── references: resolve status + per-edge advisories ──────────────────────
  for (const e of refs.edges) {
    const at: DiagnosticLocation = { docId: e.sourceDocId, pointer: e.sourceObjectId };
    const related =
      e.targetDocId != null && e.targetNodeId != null
        ? [{ docId: e.targetDocId, pointer: e.targetNodeId }]
        : undefined;
    const refExtra = {
      ref: { kind: e.kind, refString: e.refString } as DiagnosticRef,
      ...(related ? { relatedLocations: related } : {}),
    };
    if (e.status !== "resolved") {
      // In this block the status is one of the unresolved kinds; TS narrows the property but not the
      // whole edge passed by reference, so name the narrowed shape for refStatusMessage.
      const unresolved = e as UnresolvedEdge;
      emit(STATUS_CODE[unresolved.status], "reference", refStatusMessage(unresolved), at, refExtra);
    }
    // A reference can resolve yet still carry advisories (e.g. an operationRef to a webhook).
    for (const d of e.diagnostics ?? []) {
      emit(d.code, "reference", d.detail, at, refExtra);
    }
  }

  // ── document-level findings ───────────────────────────────────────────────
  for (const d of unreachable) {
    emit("document-unreachable", "reference", "not reachable from the entry document", {
      docId: d.id,
      pointer: "",
    });
  }
  for (const doc of oad.documents) {
    if (doc.schemaDialectWarning) {
      emit("schema-unvalidated", "schema", doc.schemaDialectWarning, {
        docId: doc.id,
        pointer: "",
      });
    }
  }

  // ── node-level caveats: draft-06/07 advisories + an unsupported-to-resolve dialect ────────
  for (const doc of oad.documents) {
    if (!doc.root) continue;
    walk(doc.root, (node) => {
      for (const a of node.resolutionAdvisories ?? []) {
        emit(a.code, "reference", a.detail, { docId: doc.id, pointer: node.id });
      }
      if (node.dialectResolutionWarning) {
        emit("dialect-resolution-unsupported", "schema", node.dialectResolutionWarning, {
          docId: doc.id,
          pointer: node.id,
        });
      }
    });
  }

  return out;
}

/** Index diagnostics by `docId → pointer → Diagnostic[]`, for per-node markers and detail lookups. */
export function indexByPointer(
  diags: readonly Diagnostic[],
): Map<string, Map<string, Diagnostic[]>> {
  const out = new Map<string, Map<string, Diagnostic[]>>();
  for (const d of diags) {
    const { docId, pointer } = d.location;
    let byPtr = out.get(docId);
    if (!byPtr) {
      byPtr = new Map();
      out.set(docId, byPtr);
    }
    const list = byPtr.get(pointer);
    if (list) list.push(d);
    else byPtr.set(pointer, [d]);
  }
  return out;
}

/** An edge that did not cleanly resolve — the only edges {@link refStatusMessage} is asked about. */
type UnresolvedEdge = ReferenceEdge & { status: "broken" | "external" | "type-mismatch" };

// The human text for an unresolved reference. (Mirrors issues.ts `refDetail` for now; issues.ts will
// consume buildDiagnostics in a follow-up, removing the duplication.)
function refStatusMessage(e: UnresolvedEdge): string {
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
  }
}

function typeName(requiredType: string): string {
  return requiredType === "SecurityScheme" ? "Security Scheme" : requiredType || "target";
}

function walk(node: TreeNode, fn: (n: TreeNode) => void): void {
  fn(node);
  for (const child of node.children) walk(child, fn);
}
