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

/**
 * Resolve a JSON Pointer (RFC 6901) within a parsed JSON/YAML value, returning the addressed
 * sub-value (or `undefined` if any token is missing). The root pointer "" returns the whole value.
 */
export function valueAtPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  let current = value;
  for (const rawToken of pointer.split("/").slice(1)) {
    const token = unescapeToken(rawToken);
    if (Array.isArray(current)) current = current[Number(token)];
    else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else return undefined;
  }
  return current;
}
