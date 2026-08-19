// Two prompts a client surfaces directly to a person (slash commands, menu entries), not something
// the model picks: `review-oad` seeds a call to analyze-document and a section to summarize;
// explain-issue-report turns a pasted report into a triage plan. `deps` is accepted for parity with
// registerResources — neither prompt needs fixture I/O, since a demo id and a SectionId are both
// static, build-time-known sets.

import * as z from "zod/v4";
import { completable, type McpServer } from "@modelcontextprotocol/server";
import { demos } from "../app/demos";
import type { SectionId } from "../render/issues";
import { TOOL_NAMES } from "./info";
import type { McpDeps } from "./ports";

const SECTION_IDS: readonly SectionId[] = [
  "unresolved",
  "advisories",
  "caveats",
  "unreachable",
  "unvalidated",
];

export function registerPrompts(server: McpServer, _deps: McpDeps): void {
  server.registerPrompt(
    "review-oad",
    {
      title: "Review a demo OAD",
      description:
        "Analyze one bundled demo with analyze-document, then summarize one issue-report section.",
      argsSchema: z.object({
        demo: completable(z.string().describe("Demo id"), (value) =>
          demos.map((demo) => demo.id).filter((id) => id.startsWith(value)),
        ),
        focus: completable(z.string().describe("Issue-report section to summarize"), (value) =>
          SECTION_IDS.filter((id) => id.startsWith(value)),
        ),
      }),
    },
    ({ demo, focus }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Call ${TOOL_NAMES.analyzeDocument} with { "demo": "${demo}" }, then summarize the ` +
              `"${focus}" section of the result: what it contains, and what I should do about it.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "explain-issue-report",
    {
      title: "Explain an issue report",
      description:
        "Turn a pasted issue report (the viewer's Copy button output) into a triage plan.",
      argsSchema: z.object({
        report: z.string().describe("The pasted issue report text"),
      }),
    },
    ({ report }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Triage this OAS Structure Viewer issue report into a short action plan: which " +
              "findings block using the document, which are advisory, and what to fix first.\n\n" +
              report,
          },
        },
      ],
    }),
  );
}
