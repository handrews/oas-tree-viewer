// Dynamic-scope reachability for `$dynamicRef` "strict winner" resolution.
//
// A `$dynamicRef "#T"` whose local fragment is a `$dynamicAnchor` resolves, at runtime, to the
// *outermost* schema resource in the dynamic scope that declares `$dynamicAnchor T`. The dynamic
// scope is the chain of schema resources entered (by following references / lexical descent) from
// the entry document. A static viewer can't know the instance, but it CAN bound the set of
// `$dynamicAnchor`s that could ever be that outermost resource on some entry-rooted path reaching
// the `$dynamicRef`. Those are the "winners" we draw a tentative (dotted) edge to; everything else
// — anchors that can't reach the ref, anchors always shadowed by an outer same-named anchor, and
// anchors in unreachable documents — is dropped.
//
// This module is the pure graph algorithm: it works over schema-*resource* base URIs (strings) and
// a flat list of `$dynamicAnchor`s. The resolver maps its node-level data (edges, the per-node
// resource, the anchor index) onto these primitives.

import type { TreeNode } from "../types";

/** A `$dynamicAnchor` occurrence: the resource that declares it, and its node. */
export interface AnchorRef {
  /** Base URI of the schema resource declaring the anchor. */
  resourceUri: string;
  docId: string;
  node: TreeNode;
}

export interface DynamicScopeParams {
  /** Base URI of the entry document's root resource — the single dynamic-scope root. */
  entryRoot: string;
  /** Resource-level transition edges from located references (and lexical descent). */
  resourceEdges: Array<{ from: string; to: string }>;
  /** Every dynamic `$dynamicRef` (bookend holds), for the provisional broad transitions it adds. */
  dynamicRefs: Array<{ resourceUri: string; name: string }>;
  /** Every `$dynamicAnchor`, grouped by name. */
  anchorsByName: Map<string, AnchorRef[]>;
}

export interface DynamicScopeAnalysis {
  /**
   * The `$dynamicAnchor` nodes that can be the runtime resolution of a dynamic `$dynamicRef "#name"`
   * located in resource `resourceUri`: anchors that (a) can be the *outermost* same-named anchor on
   * an entry-rooted path, and (b) can reach `resourceUri` (so the path can continue to the ref).
   */
  winners(resourceUri: string, name: string): Array<{ docId: string; node: TreeNode }>;
}

export function analyzeDynamicScope(params: DynamicScopeParams): DynamicScopeAnalysis {
  const { entryRoot, resourceEdges, dynamicRefs, anchorsByName } = params;

  // Build the resource graph G and its reverse. A `$dynamicRef`'s real targets are path-dependent,
  // so it contributes the *broad* set of provisional edges (one to every same-named anchor); this
  // over-approximates G (sound — never drops a real path) and the outermost-eligibility halt below
  // keeps it from leaking spurious winners.
  const g = new Map<string, Set<string>>();
  const grev = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string): void => {
    if (from === to) return; // self-loops don't affect reachability
    (g.get(from) ?? g.set(from, new Set()).get(from)!).add(to);
    (grev.get(to) ?? grev.set(to, new Set()).get(to)!).add(from);
  };
  for (const e of resourceEdges) addEdge(e.from, e.to);
  for (const d of dynamicRefs) {
    for (const a of anchorsByName.get(d.name) ?? []) addEdge(d.resourceUri, a.resourceUri);
  }

  const anchorResources = new Map<string, Set<string>>();
  for (const [name, list] of anchorsByName) {
    anchorResources.set(name, new Set(list.map((a) => a.resourceUri)));
  }

  // Outermost-eligible(name): same-named anchor resources that can be the *first* anchor of that
  // name on an entry-rooted path — a BFS from the entry root that floods through non-anchor
  // resources but HALTS at (records, doesn't expand past) anchor resources. Anything only reachable
  // beyond an anchor is shadowed by it, so it never qualifies.
  const eligibleCache = new Map<string, Set<string>>();
  const outermostEligible = (name: string): Set<string> => {
    const cached = eligibleCache.get(name);
    if (cached) return cached;
    const anchors = anchorResources.get(name) ?? new Set<string>();
    const eligible = new Set<string>();
    const visited = new Set<string>([entryRoot]);
    const queue: string[] = [entryRoot];
    while (queue.length) {
      const n = queue.shift()!;
      if (anchors.has(n)) {
        eligible.add(n); // halt: do not expand past an anchor resource
        continue;
      }
      for (const m of g.get(n) ?? []) {
        if (!visited.has(m)) {
          visited.add(m);
          queue.push(m);
        }
      }
    }
    eligibleCache.set(name, eligible);
    return eligible;
  };

  // The resources that can reach `uri` (reverse reachability, includes `uri` itself).
  const reachCache = new Map<string, Set<string>>();
  const reverseReachable = (uri: string): Set<string> => {
    const cached = reachCache.get(uri);
    if (cached) return cached;
    const reach = new Set<string>([uri]);
    const queue: string[] = [uri];
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of grev.get(n) ?? []) {
        if (!reach.has(m)) {
          reach.add(m);
          queue.push(m);
        }
      }
    }
    reachCache.set(uri, reach);
    return reach;
  };

  return {
    winners(resourceUri, name) {
      const eligible = outermostEligible(name);
      const reach = reverseReachable(resourceUri);
      const out: Array<{ docId: string; node: TreeNode }> = [];
      for (const a of anchorsByName.get(name) ?? []) {
        if (eligible.has(a.resourceUri) && reach.has(a.resourceUri)) {
          out.push({ docId: a.docId, node: a.node });
        }
      }
      return out;
    },
  };
}
