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
];

const byId = new Map(demos.map((d) => [d.id, d]));

export function demoById(id: string): Demo | undefined {
  return byId.get(id);
}

/** The document inputs for a demo id, or undefined if the id is unknown. */
export function demoInputs(id: string): DocInput[] | undefined {
  return byId.get(id)?.inputs;
}
