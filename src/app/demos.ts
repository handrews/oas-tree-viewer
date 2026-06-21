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

function urlDoc(name: string, isEntry = false): DocInput {
  return { source: "url", url: fixtureUrl(name), isEntry };
}

export const demos: Demo[] = [
  {
    id: "refs",
    label: "Broken & external references (3.1)",
    description:
      "A two-document OAD that exercises every reference outcome — resolved, type-mismatch, " +
      "broken, and external — so the issue report and warning glyphs have something to show.",
    inputs: [urlDoc("refs-3.1.yaml", true), urlDoc("refs-shared-3.1.yaml")],
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
];

const byId = new Map(demos.map((d) => [d.id, d]));

export function demoById(id: string): Demo | undefined {
  return byId.get(id);
}

/** The document inputs for a demo id, or undefined if the id is unknown. */
export function demoInputs(id: string): DocInput[] | undefined {
  return byId.get(id)?.inputs;
}
