// The WAI-ARIA Tree View keyboard model, as a pure decision function. Given a key and a snapshot of the
// focused row's situation, it returns *what* should happen — move focus, expand/collapse, or select — and
// the d3/SVG view (treeView.ts) carries it out. Keeping the decision here (free of the DOM and the d3
// hierarchy) makes the navigation rules directly unit-testable.

/** What a keypress should do, named by intent. The `id` is the node the action targets. */
export type TreeKeyAction =
  | { type: "focus"; id: string } // move roving focus to this node (no expand/collapse, no selection)
  | { type: "toggle"; id: string } // expand or collapse this node, keeping focus on it
  | { type: "select"; id: string } // select this node (open it in the detail panel)
  | { type: "none" }; // a handled key with nothing to do (e.g. ArrowRight on a leaf)

/** Everything the model needs about the focused row and the visible list, as plain data. */
export interface TreeKeyContext {
  key: string;
  /** Ids of the currently-visible rows, top-to-bottom (keyboard order). */
  visibleIds: readonly string[];
  /** The focused row's node id; expected to be present in {@link visibleIds}. */
  focusedId: string;
  node: {
    /** Has hidden children (a collapsed, expandable branch). */
    collapsed: boolean;
    /** Currently expanded (its children are visible). */
    expanded: boolean;
    /** First visible child's id when expanded, else null. */
    firstChildId: string | null;
    /** Parent's id, or null at the root. */
    parentId: string | null;
  };
}

/**
 * Decide the action for a keypress on the focused tree row. Returns `null` for a key the tree does not
 * handle (so the caller leaves the event alone); any non-null result — including `{ type: "none" }` —
 * means the key was handled (the caller should `preventDefault`).
 */
export function treeKeyAction(ctx: TreeKeyContext): TreeKeyAction | null {
  const { key, visibleIds, focusedId, node } = ctx;
  const i = visibleIds.indexOf(focusedId);

  switch (key) {
    case "ArrowDown":
      return focusAt(visibleIds, i + 1);
    case "ArrowUp":
      return focusAt(visibleIds, i - 1);
    case "Home":
      return focusAt(visibleIds, 0);
    case "End":
      return focusAt(visibleIds, visibleIds.length - 1);
    case "ArrowRight":
      // Collapsed branch → expand it (focus stays, so a second Right enters the first child).
      // Already-expanded branch → step into its first child. Leaf → nothing.
      if (node.collapsed) return { type: "toggle", id: focusedId };
      if (node.expanded && node.firstChildId !== null) return { type: "focus", id: node.firstChildId };
      return { type: "none" };
    case "ArrowLeft":
      // Expanded branch → collapse it (focus stays). Leaf/collapsed → step out to the parent.
      if (node.expanded) return { type: "toggle", id: focusedId };
      if (node.parentId !== null) return { type: "focus", id: node.parentId };
      return { type: "none" };
    case "Enter":
    case " ":
      return { type: "select", id: focusedId };
    default:
      return null;
  }
}

/** Focus the visible row at `index`, or do nothing (still handled) when the index is out of range. */
function focusAt(visibleIds: readonly string[], index: number): TreeKeyAction {
  const id = visibleIds[index];
  return id === undefined ? { type: "none" } : { type: "focus", id };
}
