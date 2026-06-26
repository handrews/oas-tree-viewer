// A separate, position-aware pass over a document's raw text: map every JSON Pointer to its source
// range (start/end line + column). It re-parses the text with the `yaml` CST and a LineCounter — JSON
// goes through the same path, since YAML is a superset — and walks the node tree building pointers
// exactly as treeBuilder builds TreeNode ids (RFC 6901, root ""), so a node's range is simply
// `positions.get(node.id)`. The value tree (buildTree) stays position-free; this runs alongside it.
//
// Best-effort by design: anything the CST can't locate — an alias-expanded subtree, a complex
// (non-scalar) mapping key, or a document too malformed to CST-parse — is just absent from the map,
// and callers fall back to showing the pointer without a line.

import { LineCounter, parseDocument, isMap, isScalar, isSeq } from "yaml";
import type { SourcePos, SourceRange } from "../types";
import { appendPointer } from "../model/jsonPointer";

/** Map each JSON Pointer in `text` to the source range of its value. */
export function documentPositions(text: string): Map<string, SourceRange> {
  const out = new Map<string, SourceRange>();
  const lineCounter = new LineCounter();
  let contents: unknown;
  try {
    contents = parseDocument(text, { lineCounter }).contents;
  } catch {
    return out; // unparseable as a CST — no positions, callers degrade to pointer-only
  }
  if (contents != null) walk(contents, "", out, lineCounter);
  return out;
}

function walk(
  node: unknown,
  pointer: string,
  out: Map<string, SourceRange>,
  lc: LineCounter,
): void {
  const range = rangeOf(node, lc);
  if (range) out.set(pointer, range);

  if (isMap(node)) {
    for (const pair of node.items) {
      // Only plain scalar keys address a JSON Pointer token; the value stringifies the same way
      // Object.keys does in buildTree (e.g. an unquoted YAML `200` key becomes "200"). A null value
      // node is fine — walk() treats it as a no-op.
      if (!isScalar(pair.key)) continue;
      walk(pair.value, appendPointer(pointer, String(pair.key.value)), out, lc);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => walk(item, appendPointer(pointer, String(index)), out, lc));
  }
}

/** A node's range as line/col positions, using the value span (`range[0]`..`range[1]`). */
function rangeOf(node: unknown, lc: LineCounter): SourceRange | null {
  const range = (node as { range?: [number, number, number] | null } | null)?.range;
  if (!range) return null;
  return { start: pos(lc, range[0]), end: pos(lc, range[1]) };
}

function pos(lc: LineCounter, offset: number): SourcePos {
  const { line, col } = lc.linePos(offset);
  return { line, col };
}
