// RFC 6901 JSON Pointer helpers. Pointers address nodes within a single document.

/** Escape a single reference token: "~" -> "~0", "/" -> "~1" (order matters). */
export function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Inverse of {@link escapeToken}; useful when displaying or resolving pointers. */
export function unescapeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Append a property name or array index to a parent pointer. Root pointer is "". */
export function appendPointer(parent: string, token: string): string {
  return `${parent}/${escapeToken(token)}`;
}

/** Display form of a pointer: the empty root pointer reads better as "#". */
export function displayPointer(pointer: string): string {
  return pointer === "" ? "#" : `#${pointer}`;
}
