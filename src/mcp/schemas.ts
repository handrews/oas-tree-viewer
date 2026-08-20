// zod input/output contracts for the two tools. Deliberately no `.transform()`/`.refine()` (see
// vitest.config.ts's functions:100 gate): each such closure is a function the coverage gate then
// demands its own exercise, and plain enums/objects say everything these two tools need — the
// `demo`/`documents` exclusivity check and the caps live in analyze.ts instead, as ordinary code.

import * as z from "zod/v4";
import { DIAGNOSTIC_CODES } from "../diagnostics/types";
import { FRAGMENTS_CONTROL_LABEL, fragmentsFieldDescription } from "../app/fragmentsText";
import { MAX_DOC_CHARS, MAX_INLINE_DOCS } from "./info";

const SeverityEnum = z.enum(["error", "warning", "info"]);
const SeverityPolicyEnum = z.enum(["error", "warning", "info", "off"]);
const DiagnosticSourceEnum = z.enum(["reference", "schema", "semantic", "external"]);
const SectionIdEnum = z.enum(["unresolved", "advisories", "caveats", "unreachable", "unvalidated"]);
const DocKindEnum = z.enum(["openapi", "schema", "fragment"]);
const VersionFamilyEnum = z.enum(["3.0", "3.1", "3.2"]);
// Shared with the fragment-consent elicitation in server.ts, so the tool's `config.fragments` input
// and the elicited answer can never drift apart. Described once here (from the same text the
// Configure page's selector uses — src/app/fragmentsText.ts) so `config.fragments` and the
// elicitation's `fragments` answer both carry it in their JSON Schema, since both fields reuse this
// one enum.
export const FragmentsEnum = z
  .enum(["none", "root", "any"])
  .describe(fragmentsFieldDescription())
  .meta({ title: FRAGMENTS_CONTROL_LABEL });
const RefKindEnum = z.enum([
  "$ref",
  "$dynamicRef",
  "$recursiveRef",
  "operationRef",
  "operationId",
  "discriminatorMapping",
  "securityRequirement",
]);
const DiagnosticCodeEnum = z.enum(DIAGNOSTIC_CODES);

// ── analyze-document ────────────────────────────────────────────────────────

const InlineDocumentSchema = z.object({
  filename: z.string().min(1),
  text: z.string().max(MAX_DOC_CHARS),
  retrievalUri: z.string().optional(),
  isEntry: z.boolean(),
});

// Titles/descriptions mirror the Configure page's "Resolution options" box (src/pages/ConfigurePage.svelte)
// so the same choice reads the same in both places; only `fragments` needs a shared module (its wording
// also appears in the loader error and the elicitation message — see fragmentsFieldDescription).
const MappingPrecedenceEnum = z
  .enum(["name-first", "uri-first"])
  .describe(
    'How a discriminator "mapping" value resolves: a component name first (default), or a ' +
      "URI-reference first.",
  )
  .meta({ title: "Mapping precedence" });

const ComponentLookupEnum = z
  .enum(["entry", "local"])
  .describe(
    "Where a component name is looked up (mapping and Security Requirement values): the entry " +
      "document (default), or the local document.",
  )
  .meta({ title: "Component lookup" });

/** Mirrors ViewerConfig (src/app/config.ts) field-for-field; every field optional so an omitted
 *  choice falls back to defaultConfig. */
const ConfigInputSchema = z
  .object({
    mappingPrecedence: MappingPrecedenceEnum.optional(),
    componentLookup: ComponentLookupEnum.optional(),
    fragments: FragmentsEnum.optional(),
  })
  .describe("Resolution options, mirroring the viewer's Configure page.")
  .meta({ title: "Resolution options" });

export const AnalyzeInputSchema = z.object({
  demo: z.string().optional(),
  documents: z.array(InlineDocumentSchema).max(MAX_INLINE_DOCS).optional(),
  config: ConfigInputSchema.optional(),
  minSeverity: SeverityEnum.default("info"),
});

export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

const LocationSchema = z.object({
  documentIndex: z.number().int().nonnegative(),
  document: z.string(),
  pointer: z.string(),
  displayPointer: z.string(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});

const RefViewSchema = z.object({
  kind: RefKindEnum.optional(),
  refString: z.string(),
});

const DiagnosticViewSchema = z.object({
  code: DiagnosticCodeEnum,
  title: z.string(),
  severity: SeverityEnum,
  defaultSeverity: SeverityPolicyEnum,
  source: DiagnosticSourceEnum,
  section: SectionIdEnum,
  message: z.string(),
  location: LocationSchema,
  relatedLocations: z.array(LocationSchema).optional(),
  ref: RefViewSchema.optional(),
  catalogUri: z.string(),
});

const DocumentSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  label: z.string(),
  kind: DocKindEnum,
  oasVersion: z.string().optional(),
  isEntry: z.boolean(),
});

const SectionSummarySchema = z.object({
  id: SectionIdEnum,
  label: z.string(),
  count: z.number().int().nonnegative(),
});

const CountsSchema = z.object({
  total: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});

export const AnalyzeOutputSchema = z.object({
  entry: z.string(),
  versionFamily: VersionFamilyEnum,
  documents: z.array(DocumentSummarySchema),
  counts: CountsSchema,
  sections: z.array(SectionSummarySchema),
  diagnostics: z.array(DiagnosticViewSchema),
});

export type AnalyzeOutput = z.infer<typeof AnalyzeOutputSchema>;

/** What a declined/cancelled MRTR round returns instead of `AnalyzeOutputSchema`: the tool's
 *  registered `outputSchema` demands `structuredContent` on every non-`isError` result (the SDK
 *  checks this — see `refusal()` in server.ts), and a refusal has no analysis to report, so it gets
 *  its own small shape rather than a fabricated empty success result. */
export const AnalyzeDeclinedSchema = z.object({
  declined: z.object({
    action: z.enum(["decline", "cancel"]),
    question: z.enum(["entry", "fragments"]),
  }),
});
export type AnalyzeDeclined = z.infer<typeof AnalyzeDeclinedSchema>;

/** The tool's actual advertised `outputSchema` (registered in server.ts) — wider than
 *  `AnalyzeOutputSchema` alone so `tools/list` honestly documents that a declined/cancelled MRTR
 *  round is a possible non-error result, not just the analysis shape. */
export const AnalyzeToolOutputSchema = z.union([AnalyzeOutputSchema, AnalyzeDeclinedSchema]);

// ── explain-diagnostic ──────────────────────────────────────────────────────

export const ExplainInputSchema = z.object({ code: DiagnosticCodeEnum });
export type ExplainInput = z.infer<typeof ExplainInputSchema>;

export const ExplainOutputSchema = z.object({
  code: DiagnosticCodeEnum,
  title: z.string(),
  description: z.string(),
  defaultSeverity: SeverityPolicyEnum,
  enabled: z.boolean(),
  section: SectionIdEnum,
  catalogUri: z.string(),
});

export type ExplainOutput = z.infer<typeof ExplainOutputSchema>;

// ── analyze-document elicitations (MRTR) ───────────────────────────────────

/** The fragment-consent answer: the same enum `config.fragments` takes, so the client is choosing
 *  from the exact set the tool would otherwise have accepted up front. */
export const FragmentsAnswerSchema = z.object({ fragments: FragmentsEnum });
export type FragmentsAnswer = z.infer<typeof FragmentsAnswerSchema>;

/** The ambiguous-entry answer: a string enum of the filenames actually supplied, built fresh per
 *  call (the candidates are `args.documents`, not a fixed contract) rather than kept as a module
 *  constant like the schemas above. */
export function entryAnswerSchema(filenames: string[]) {
  return z.object({ entry: z.enum(filenames) });
}
