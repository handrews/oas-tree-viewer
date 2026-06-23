// Pre-configured demos: named document sets a user can explore without choosing files.
// They load as same-origin fixtures (served from public/fixtures), so there is no CORS
// dependency, and they encode into the view URL as `?demo=<id>` (bookmarkable). The data
// is framework-free so it is unit-testable in node.

import type { DocInput } from "../loader";

export interface Demo {
  id: string;
  label: string;
  description: string;
  /** Document inputs, entry first. */
  inputs: DocInput[];
}

/** Root-absolute same-origin fixture URL, so it resolves the same under any in-app route. */
function fixtureUrl(name: string): string {
  return `/fixtures/${name}`;
}

function urlDoc(name: string, isEntry = false, retrievalUri?: string): DocInput {
  return { source: "url", url: fixtureUrl(name), isEntry, retrievalUri };
}

export const demos: Demo[] = [
  {
    id: "refs",
    label: "Broken & external references (3.1)",
    description:
      "A two-document OAD that exercises every reference outcome — resolved, type-mismatch, " +
      "broken, and external — so the issue report and warning glyphs have something to show.",
    inputs: [
      urlDoc("refs-3.1.yaml", true, "https://example.com/oad/entry.yaml"),
      urlDoc("refs-shared-3.1.yaml", false, "https://example.com/oad/shared.yaml"),
    ],
  },
  {
    id: "self",
    label: "Multi-document $self (3.2)",
    description:
      "A clean four-document OAD using OAS 3.2 $self: each document self-identifies, so every " +
      "cross-document reference resolves by identity regardless of where the files are served.",
    inputs: [
      urlDoc("oads/openapi.yaml", true),
      urlDoc("oads/parameters.yaml"),
      urlDoc("oads/mediatypes.yaml"),
      urlDoc("oads/schemas.yaml"),
    ],
  },
  {
    id: "component-refs",
    label: "Component-name references (3.2)",
    description:
      "Implicit connections — discriminator mapping values and Security Requirement keys — resolving " +
      "as component names (diamond, double line) or URI-references (asterisk, single line). Use the " +
      "Resolution options to flip the ambiguous “dual” mapping, and to look up the referenced " +
      "document’s names in the entry vs. the local document.",
    inputs: [
      urlDoc("component-refs-3.2.yaml", true),
      urlDoc("component-refs-shared-3.2.yaml"),
      urlDoc("component-refs-pets-3.2.yaml"),
    ],
  },
  {
    id: "operation-refs",
    label: "Operation references (3.2)",
    description:
      "operationRef Links pointing at Operations in every habitat, so each operation-reference " +
      "advisory shows: a clean path target, a webhook and a callback (not directly callable), and " +
      "component Path Items reached by 2 / 1 / 0 paths (ambiguous, fragile, no URL). One Path Item " +
      "$ref also collides with its target on the “summary” field (undefined merge).",
    inputs: [urlDoc("operation-refs-3.2.yaml", true)],
  },
  {
    id: "operationid",
    label: "operationId links (3.2)",
    description:
      "Link Objects resolving an Operation by operationId (an implicit connection, drawn like a " +
      "component name): a unique match, a match in another reachable document, a missing one " +
      "(broken), and a target reachable only by operationId (its document stays unreachable). The " +
      "remaining Links resolve but aren’t cleanly invocable — a Components Path Item reached by " +
      "2 / 1 / 0 paths, a webhook, and a callback — reusing the operation-target advisories.",
    inputs: [
      urlDoc("operationid-3.2.yaml", true),
      urlDoc("operationid-shared-3.2.yaml"),
      urlDoc("operationid-remote-3.2.yaml"),
    ],
  },
  {
    id: "dynamicref",
    label: "$dynamicRef / $dynamicAnchor (3.1)",
    description:
      "JSON-Schema dynamic references: GenericList's $dynamicRef (#item) points tentatively " +
      "(dotted) only at the $dynamicAnchors that could actually be its runtime resolution — the " +
      "outermost same-named anchor on an entry-rooted path that reaches the ref. The entry uses " +
      "StrictList and LooseList, which override item and extend GenericList, so both win; " +
      "GenericList's own default is always shadowed (hidden), Unrelated's item can't reach the ref " +
      "(hidden), and the remote document is unreachable (hidden). Plus the two static cases — a " +
      "$dynamicRef whose local fragment is a plain $anchor (resolves like $ref), and a $ref landing " +
      "on a $dynamicAnchor (treated like $anchor) — and a broken $dynamicRef.",
    inputs: [
      urlDoc("dynamicref-3.1.yaml", true, "https://example.com/oad/dynamicref"),
      urlDoc("dynamicref-shared-3.1.yaml", false, "https://example.com/oad/dynamicref-shared"),
      urlDoc("dynamicref-remote-3.1.yaml", false, "https://example.com/oad/dynamicref-remote"),
    ],
  },
  {
    id: "recursiveref",
    label: "$recursiveRef / $recursiveAnchor (2019-09)",
    description:
      "draft-2019-09 recursive references — the anonymous form of $dynamicRef. GenericTree's " +
      "$recursiveRef (#) fans out tentatively (dotted) to the outermost $recursiveAnchor: true " +
      "resources on an entry-rooted path: StrictTree and LooseTree, which both extend GenericTree, so " +
      "both win (GenericTree's own anchor is shadowed). PlainTree declares no $recursiveAnchor, so its " +
      "$recursiveRef is a plain static self-reference. The anonymous anchor has no name, so it can't be " +
      "reached by a $ref fragment at all.",
    inputs: [urlDoc("recursiveref-3.1.yaml", true)],
  },
  {
    id: "numbered-drafts",
    label: "draft-04/06/07 references (3.1)",
    description:
      "The numbered-draft identification model: named anchors come from identifier fragments (not " +
      "$anchor), keywords beside $ref are ignored, and a JSON-Pointer identifier fragment must be the " +
      "schema's own location. Catalog (draft-07) resolves a $ref to an $id-fragment anchor, warns on " +
      "an ignored-sibling $ref and a mis-pointed $id, and breaks where it leans on a non-existent " +
      "$anchor; Draft04 (draft-04) does the same but with the un-prefixed `id` keyword; Modern " +
      "re-declares 2020-12, where $anchor still resolves.",
    inputs: [urlDoc("numbered-drafts-3.1.yaml", true)],
  },
  {
    id: "dialects",
    label: "Mixed Schema-Object dialects (3.1)",
    description:
      "Per-resource validation: each Schema Object is checked against the dialect it declares — the " +
      "OAS dialect, JSON Schema 2020-12, or draft-07. The viewer only resolves references for the OAS " +
      "dialect and 2020-12, so the draft-07 schema's $schema row carries a ⚠ (with a detail-panel " +
      "note) even though it still validates.",
    inputs: [urlDoc("dialects-3.1.yaml", true)],
  },
];

const byId = new Map(demos.map((d) => [d.id, d]));

export function demoById(id: string): Demo | undefined {
  return byId.get(id);
}

/** The document inputs for a demo id, or undefined if the id is unknown. */
export function demoInputs(id: string): DocInput[] | undefined {
  return byId.get(id)?.inputs;
}
