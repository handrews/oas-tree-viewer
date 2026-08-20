// Single source of truth for the "Document types" (fragments) setting's user-facing wording. The
// same setting shows up in four places — the Configure page's selector, the loader's
// unrecognized-document error, the MCP tool's schema (config.fragments and the fragment-consent
// elicitation answer share one zod enum), and the elicitation message itself — and used to describe
// itself differently in each. Everything that names or explains the setting reads from here instead,
// so the wording can only drift by editing this file. It sits below the app layer because
// `loader.ts` (engine) builds its error text from it; `ViewerConfig.fragments` (src/app/config.ts)
// takes its value type from here for the same single-source reason.

export type FragmentsValue = "none" | "root" | "any";

/** The control's display name, as the Configure page labels its selector. */
export const FRAGMENTS_CONTROL_LABEL = "Document types";

export interface FragmentsOption {
  value: FragmentsValue;
  /** The Configure page's `<option>` wording for this choice. */
  label: string;
  /** One verb-phrase clause explaining what this choice does, reused to build both the MCP schema's
   *  field description and the fragment-consent elicitation message. */
  detail: string;
}

export const FRAGMENTS_OPTIONS: readonly FragmentsOption[] = [
  {
    value: "none",
    label: "Complete OpenAPI or JSON Schema documents only",
    detail: "refuses a fragment entirely",
  },
  {
    value: "root",
    label: "Allow fragmentary OpenAPI documents if their root is referenced",
    detail: "loads a fragment only if a reference points at its root",
  },
  {
    value: "any",
    label: "Allow any fragmentary OpenAPI document",
    detail:
      "also types a fragment from references to its interior, tolerating one left unreferenced",
  },
];

export function fragmentsOption(value: FragmentsValue): FragmentsOption {
  return FRAGMENTS_OPTIONS.find((o) => o.value === value)!;
}

/** The `config.fragments` / elicitation-answer field description, covering all three choices in one
 *  sentence — what the MCP schema's `.describe()` shows and `ArgsForm.svelte` renders as a hint. */
export function fragmentsFieldDescription(): string {
  return (
    "Whether to load fragmentary documents (neither a complete OpenAPI document nor a recognized " +
    `JSON Schema document): ${FRAGMENTS_OPTIONS.map((o) => `"${o.value}" ${o.detail}`).join("; ")}.`
  );
}

/**
 * The loader's unrecognized-document error ends with this sentence, naming the control so a person
 * can find it. `analyze.ts`'s MRTR fragment-consent detection string-matches this exact tail (see
 * `FRAGMENT_HINT_SUFFIX`), so both must derive from this constant — never a hand-copied literal — or
 * the elicitation silently stops triggering.
 */
export const FRAGMENTS_LOAD_HINT = `To load it as a fragment, allow fragmentary documents under "${FRAGMENTS_CONTROL_LABEL}".`;
