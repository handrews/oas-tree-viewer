// `oas:` URIs, minted in one place so every caller that needs a diagnostic's `oas://diagnostic/{code}`
// URI produces the exact same string.

export function diagnosticUri(code: string): string {
  return `oas://diagnostic/${code}`;
}
