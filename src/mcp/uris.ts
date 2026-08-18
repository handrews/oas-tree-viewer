// `oas:` URIs, minted in one place so every caller that needs one — a diagnostic's `catalogUri`, a
// `resource_link` to a demo, a resource template's own pattern — produces the exact same string.
// `diagnosticUri("{code}")` etc. also mints a template's URI pattern, so the pattern registered with
// the SDK and the concrete URIs it matches never drift apart.

export const CATALOG_DIAGNOSTICS_URI = "oas://catalog/diagnostics";
export const CATALOG_DEMOS_URI = "oas://catalog/demos";

export function diagnosticUri(code: string): string {
  return `oas://diagnostic/${code}`;
}

export function demoUri(demoId: string): string {
  return `oas://demo/${demoId}`;
}

export function demoDocUri(demoId: string, filename: string): string {
  return `oas://demo/${demoId}/${filename}`;
}
