// Semantic advisories for references that *resolve* but point somewhere problematic — kept
// orthogonal to the resolve status (resolved / type-mismatch / broken / external):
//
//  - a Path Item `$ref` whose sibling field also appears in the referenced Path Item, where the
//    OAS leaves the merge behavior undefined; and
//  - an operation reference (`operationRef` today, `operationId` later) whose target Operation is
//    not (unambiguously) invocable: it lives under `webhooks` or a `callbacks` entry, or inside a
//    Components Path Item reached from the entry document's Paths Object by some number of paths
//    other than exactly one.
//
// The analysis is grammar-aware via the classifier's `oasType` labels (set before resolution), so
// it never sniffs JSON-Pointer strings — a path template literally named `webhooks` is still a
// path, not a webhook. Pure and node-testable.

import type { Oad, OadDocument, TreeNode } from "../types";
import type { EdgeDiagnostic, ReferenceEdge } from "./types";
import { refKey } from "./types";

/** Where a Path Item Object (and the Operations under it) lives in the document grammar. */
type Habitat = "path" | "webhook" | "callback" | "component";

interface OpInfo {
  habitat: Habitat;
  /** refKey of the Operation's enclosing Path Item — the key the component-reach map uses. */
  pathItemKey: string;
}

/**
 * Annotate edges in place with semantic advisories. `pointerIndex` (docId → pointer → node, built
 * by the resolver) is reused for the Path-Item-overlap field comparison.
 */
export function annotateDiagnostics(
  oad: Oad,
  edges: ReferenceEdge[],
  pointerIndex: Map<string, Map<string, TreeNode>>,
): void {
  const opByKey = new Map<string, OpInfo>();
  const pathItemHabitat = new Map<string, Habitat>();
  for (const doc of oad.documents) tagHabitats(doc, opByKey, pathItemHabitat);

  const reach = componentReach(oad, edges, pathItemHabitat);

  for (const e of edges) {
    pathItemOverlap(e, pointerIndex);
    operationTarget(e, opByKey, reach);
  }
}

// ── habitat tagging ───────────────────────────────────────────────────────────

/** Walk a document, recording each Path Item's habitat and each Operation's habitat + parent. */
function tagHabitats(
  doc: OadDocument,
  opByKey: Map<string, OpInfo>,
  pathItemHabitat: Map<string, Habitat>,
): void {
  const visit = (node: TreeNode): void => {
    const habitat = containerHabitat(node);
    if (habitat) {
      // Every child of a Path-Item container is a Path Item (possibly a Reference Object).
      for (const pi of node.children) {
        const pathItemKey = refKey(doc.id, pi.id);
        pathItemHabitat.set(pathItemKey, habitat);
        for (const op of operationChildren(pi)) {
          opByKey.set(refKey(doc.id, op.id), { habitat, pathItemKey });
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(doc.root);
}

/** The habitat a node imparts to its Path Item children, or null if it isn't such a container. */
function containerHabitat(node: TreeNode): Habitat | null {
  switch (node.oasType) {
    case "Paths Object":
      return "path";
    case "Callback Object":
      return "callback";
    case "Map of Path Item Object":
      // The only two `map: PathItem` fields in the grammar; keyed by their field name, not data.
      if (node.key === "webhooks") return "webhook";
      if (node.key === "pathItems") return "component";
      return null;
    default:
      return null;
  }
}

/** The Operation Objects directly under a Path Item (incl. 3.2 `additionalOperations`). */
function operationChildren(pathItem: TreeNode): TreeNode[] {
  const ops: TreeNode[] = [];
  for (const child of pathItem.children) {
    if (child.oasType === "Operation Object") {
      ops.push(child);
    } else if (child.oasType === "Map of Operation Object") {
      for (const op of child.children) if (op.oasType === "Operation Object") ops.push(op);
    }
  }
  return ops;
}

// ── component reachability from the entry Paths Object ─────────────────────────

/**
 * For each Components Path Item, the number of distinct entry-document Paths Object entries that
 * reach it by following Path Item `$ref` edges (transitively; cycle-guarded). Components not
 * reached by any path are simply absent (count 0).
 */
function componentReach(
  oad: Oad,
  edges: ReferenceEdge[],
  pathItemHabitat: Map<string, Habitat>,
): Map<string, number> {
  // Adjacency over resolved Path Item `$ref` edges: source Path Item → target Path Item.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "$ref" || e.context !== "pathItem" || e.status !== "resolved") continue;
    if (e.targetDocId == null || e.targetNodeId == null) continue;
    const from = refKey(e.sourceDocId, e.sourceObjectId);
    const to = refKey(e.targetDocId, e.targetNodeId);
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  }

  const entry = oad.documents.find((d) => d.isEntry) ?? oad.documents[0];
  const origins: string[] = [];
  if (entry) {
    const paths = entry.root.children.find((c) => c.oasType === "Paths Object");
    if (paths) for (const pe of paths.children) origins.push(refKey(entry.id, pe.id));
  }

  const reached = new Map<string, Set<string>>(); // component pathItemKey → set of origins
  for (const origin of origins) {
    const seen = new Set<string>([origin]);
    const queue = [origin];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (pathItemHabitat.get(next) === "component") {
          const set = reached.get(next);
          if (set) set.add(origin);
          else reached.set(next, new Set([origin]));
        }
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }

  const counts = new Map<string, number>();
  for (const [k, set] of reached) counts.set(k, set.size);
  return counts;
}

// ── per-edge advisories ────────────────────────────────────────────────────────

/** Path Item `$ref` whose sibling field collides with a field in the referenced Path Item. */
function pathItemOverlap(
  e: ReferenceEdge,
  pointerIndex: Map<string, Map<string, TreeNode>>,
): void {
  if (e.kind !== "$ref" || e.context !== "pathItem" || e.status !== "resolved") return;
  if (e.targetDocId == null || e.targetNodeId == null) return;
  const src = pointerIndex.get(e.sourceDocId)?.get(e.sourceObjectId);
  const tgt = pointerIndex.get(e.targetDocId)?.get(e.targetNodeId);
  if (!src || !tgt) return;

  const targetKeys = new Set<string>();
  for (const c of tgt.children) if (c.key !== null) targetKeys.add(c.key);
  const shared: string[] = [];
  for (const c of src.children) {
    if (c.key !== null && c.key !== "$ref" && targetKeys.has(c.key)) shared.push(c.key);
  }
  if (shared.length) {
    addDiagnostic(e, {
      code: "pathitem-field-overlap",
      severity: "error",
      detail: `also defined in the referenced Path Item: ${shared.join(", ")} (merge behavior is undefined)`,
    });
  }
}

/** Operation reference (operationRef / future operationId) whose target isn't cleanly invocable. */
function operationTarget(
  e: ReferenceEdge,
  opByKey: Map<string, OpInfo>,
  reach: Map<string, number>,
): void {
  // requiredType "Operation" uniquely marks operation-invocation refs (operationRef today,
  // operationId later); both resolve to an Operation node, so this needs no per-kind change.
  if (e.requiredType !== "Operation" || e.status !== "resolved") return;
  if (e.targetDocId == null || e.targetNodeId == null) return;
  const info = opByKey.get(refKey(e.targetDocId, e.targetNodeId));
  if (!info) return;
  const diag = targetDiagnostic(info, reach);
  if (diag) addDiagnostic(e, diag);
}

function targetDiagnostic(info: OpInfo, reach: Map<string, number>): EdgeDiagnostic | null {
  switch (info.habitat) {
    case "path":
      return null;
    case "webhook":
      return {
        code: "operation-target-webhook",
        severity: "error",
        detail: "the target Operation is a webhook, which is not directly callable",
      };
    case "callback":
      return {
        code: "operation-target-callback",
        severity: "error",
        detail:
          "the target Operation is a callback; its URL is a runtime expression, not directly callable",
      };
    case "component": {
      const count = reach.get(info.pathItemKey) ?? 0;
      if (count >= 2) {
        return {
          code: "operation-target-ambiguous",
          severity: "error",
          detail: `the target Operation's Path Item is reached by ${count} paths, so which URL invokes it is ambiguous`,
        };
      }
      if (count === 1) {
        return {
          code: "operation-target-fragile",
          severity: "warning",
          detail:
            "the target Operation's Path Item is reached by exactly one path; another path referencing it would make the target ambiguous",
        };
      }
      return {
        code: "operation-target-no-path",
        severity: "error",
        detail:
          "the target Operation's Path Item is not reached by any path, so there is no URL to invoke it",
      };
    }
  }
}

function addDiagnostic(e: ReferenceEdge, d: EdgeDiagnostic): void {
  (e.diagnostics ??= []).push(d);
}
