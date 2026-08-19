// Document sets that put the server in a state it cannot resolve on its own, so the MCP page can
// demonstrate an elicitation round trip. No bundled demo can do this: a demo's own config wins over
// the caller's (see analyze.ts), so a demo that needs fragments enabled always arrives with them
// already enabled. These are inline documents instead, which is the only input shape that can reach
// the `input_required` path.

import type { InlineDoc } from "./documents";

export interface Scenario {
  id: string;
  label: string;
  /** What the server will ask, and why it has to ask rather than choose. */
  description: string;
  docs: InlineDoc[];
}

const FRAGMENT_ENTRY = `openapi: 3.0.4
info:
  title: Fragment consent
  version: "1.0"
paths:
  /pets:
    $ref: pathitem.yaml
`;

// No openapi/$id/$schema of its own, so its type is knowable only from the reference that points at
// it — which is exactly the judgement the server refuses to make unasked.
const FRAGMENT_TARGET = `get:
  operationId: listPets
  responses:
    "200":
      description: ok
`;

export const scenarios: readonly Scenario[] = [
  {
    id: "fragment-consent",
    label: "A document fragment",
    description:
      "The second document is a bare Path Item Object — neither a complete OpenAPI description " +
      "nor a recognized JSON Schema. Loading it means widening the fragment setting, so the " +
      "server returns input_required and asks, rather than deciding for you.",
    docs: [
      { filename: "entry.yaml", text: FRAGMENT_ENTRY, isEntry: true },
      { filename: "pathitem.yaml", text: FRAGMENT_TARGET, isEntry: false },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
