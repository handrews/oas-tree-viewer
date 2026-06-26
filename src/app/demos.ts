// Pre-configured demos: named document sets a user can explore without choosing files.
// They load as same-origin fixtures (served from public/fixtures), so there is no CORS
// dependency, and they encode into the view URL as `?demo=<id>` (bookmarkable). The data
// is framework-free so it is unit-testable in node.
//
// The user-facing copy (each demo's label + description) lives in content/demos.yaml, keyed by id, so
// it can be reviewed/edited without touching code (edit the YAML, then rebuild). This module keeps the
// structural part (id/inputs/config) and merges the copy back in by id at module load.

import { parse } from "yaml";
import demosCopyText from "../../content/demos.yaml?raw";
import type { DocInput } from "../loader";
import type { ViewerConfig } from "./config";

export interface Demo {
  id: string;
  label: string;
  description: string;
  /** Document inputs, entry first. */
  inputs: DocInput[];
  /** Resolution options this demo needs (e.g. enabling fragments), merged over the current config. */
  config?: Partial<ViewerConfig>;
}

/** A demo's structure (id + documents + config); its label/description come from content/demos.yaml. */
interface DemoStructure {
  id: string;
  inputs: DocInput[];
  config?: Partial<ViewerConfig>;
}

/** User-facing copy for one demo, as authored in content/demos.yaml. */
interface DemoCopy {
  label: string;
  description: string;
}

const demoCopy = parse(demosCopyText) as Record<string, DemoCopy>;

/**
 * Same-origin fixture URL under the deploy base (Vite `import.meta.env.BASE_URL`), so it resolves the
 * same under any in-app route AND under a sub-path deploy (e.g. "/projects/oas/fixtures/…"). A bare
 * root-absolute "/fixtures/…" would escape the sub-path and 404 (then hit the SPA fallback).
 */
export function fixtureUrl(name: string): string {
  return `${import.meta.env.BASE_URL}fixtures/${name}`;
}

function urlDoc(name: string, isEntry = false, retrievalUri?: string): DocInput {
  return { source: "url", url: fixtureUrl(name), isEntry, retrievalUri };
}

const demoStructure: DemoStructure[] = [
  {
    id: "refs",
    inputs: [
      urlDoc("refs-3.1.yaml", true, "https://example.com/oad/entry.yaml"),
      urlDoc("refs-shared-3.1.yaml", false, "https://example.com/oad/shared.yaml"),
    ],
  },
  {
    id: "self",
    inputs: [
      urlDoc("oads/openapi.yaml", true),
      urlDoc("oads/parameters.yaml"),
      urlDoc("oads/mediatypes.yaml"),
      urlDoc("oads/schemas.yaml"),
    ],
  },
  {
    id: "component-refs",
    inputs: [
      urlDoc("component-refs-3.2.yaml", true),
      urlDoc("component-refs-shared-3.2.yaml"),
      urlDoc("component-refs-pets-3.2.yaml"),
    ],
  },
  {
    id: "operation-refs",
    inputs: [urlDoc("operation-refs-3.2.yaml", true)],
  },
  {
    id: "operationid",
    inputs: [
      urlDoc("operationid-3.2.yaml", true),
      urlDoc("operationid-shared-3.2.yaml"),
      urlDoc("operationid-remote-3.2.yaml"),
    ],
  },
  {
    id: "dynamicref",
    inputs: [
      urlDoc("dynamicref-3.1.yaml", true, "https://example.com/oad/dynamicref"),
      urlDoc("dynamicref-shared-3.1.yaml", false, "https://example.com/oad/dynamicref-shared"),
      urlDoc("dynamicref-remote-3.1.yaml", false, "https://example.com/oad/dynamicref-remote"),
    ],
  },
  {
    id: "recursiveref",
    inputs: [urlDoc("recursiveref-3.1.yaml", true)],
  },
  {
    id: "numbered-drafts",
    inputs: [urlDoc("numbered-drafts-3.1.yaml", true)],
  },
  {
    id: "dialects",
    inputs: [urlDoc("dialects-3.1.yaml", true)],
  },
  {
    id: "jsonschema",
    inputs: [urlDoc("jsonschema-2020-12.yaml", true)],
  },
  {
    id: "fragment",
    inputs: [
      urlDoc("ref-to-fragment-3.0.yaml", true, "https://example.com/oad/ref-to-fragment-3.0.yaml"),
      urlDoc("pet-pathitem-3.0.yaml", false, "https://example.com/oad/pet-pathitem-3.0.yaml"),
      urlDoc("pet-schema-3.0.yaml", false, "https://example.com/oad/pet-schema-3.0.yaml"),
    ],
    config: { fragments: "root" },
  },
  {
    id: "fragment-interior",
    inputs: [
      urlDoc("schema-lib-refs-3.0.yaml", true, "https://example.com/oad/schema-lib-refs-3.0.yaml"),
      urlDoc("schema-lib-3.0.yaml", false, "https://example.com/oad/schema-lib-3.0.yaml"),
    ],
    config: { fragments: "any" },
  },
];

/** Demos with their YAML-authored copy merged in by id (fails fast if a demo has no copy entry). */
export const demos: Demo[] = demoStructure.map((s) => {
  const copy = demoCopy[s.id];
  if (!copy) throw new Error(`Missing demo copy for "${s.id}" in content/demos.yaml`);
  return { ...s, label: copy.label, description: copy.description };
});

const byId = new Map(demos.map((d) => [d.id, d]));

export function demoById(id: string): Demo | undefined {
  return byId.get(id);
}

/** The document inputs for a demo id, or undefined if the id is unknown. */
export function demoInputs(id: string): DocInput[] | undefined {
  return byId.get(id)?.inputs;
}
