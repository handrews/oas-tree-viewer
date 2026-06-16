// URI helpers for reference resolution: splitting fragments, testing absoluteness,
// resolving a reference against a base URI, and light normalization.

/** True if `s` has a scheme (is an absolute URI). */
export function isAbsoluteUri(s: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s);
}

/** Split a reference into its URI part and fragment (without the `#`). */
export function splitFragment(ref: string): { uriPart: string; fragment: string | null } {
  const hash = ref.indexOf("#");
  if (hash < 0) return { uriPart: ref, fragment: null };
  return { uriPart: ref.slice(0, hash), fragment: ref.slice(hash + 1) };
}

/** Normalize an absolute URI (case of scheme/host, dot-segments, default ports). */
export function normalizeUri(u: string): string {
  try {
    return new URL(u).href;
  } catch {
    return u;
  }
}

/**
 * Resolve the URI part of a reference against a base URI, returning a normalized
 * absolute URI, or `null` when it cannot be resolved (relative ref with no usable
 * base, or a base whose scheme does not support relative resolution, e.g. `urn:`).
 */
export function resolveUri(uriPart: string, base: string | undefined): string | null {
  if (uriPart === "") return base ? normalizeUri(base) : null;
  if (isAbsoluteUri(uriPart)) return normalizeUri(uriPart);
  if (base && isAbsoluteUri(base)) {
    try {
      return new URL(uriPart, base).href;
    } catch {
      return null;
    }
  }
  return null;
}

/** Percent-decode a fragment so it can be used as a JSON Pointer / anchor name. */
export function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
