import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MAX_DOC_CHARS, MAX_INLINE_DOCS, TOOL_NAMES } from "../../src/mcp/info";
import type { AnalyzeOutput } from "../../src/mcp/schemas";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

const SINGLE_DOC = `
openapi: 3.1.0
info: { title: Single, version: "1.0.0" }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
`;

const ENTRY_DOC = `
openapi: 3.1.0
info: { title: Multi, version: "1.0.0" }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: 'shared.yaml#/components/schemas/Pet' }
`;

const SHARED_DOC = `
openapi: 3.1.0
info: { title: Shared, version: "1.0.0" }
paths: {}
components:
  schemas:
    Pet:
      type: object
      properties:
        name: { type: string }
`;

// A bare Path Item Object fragment (no openapi/$id/$schema) — loads only with fragments enabled,
// same shape as the "fragment" demo's own fixtures (public/fixtures/pet-pathitem-3.0.yaml).
const FRAGMENT_ENTRY = `
openapi: 3.0.4
info: { title: Fragment demo, version: "1.0" }
paths:
  /pets:
    $ref: pathitem.yaml
`;
const FRAGMENT_PATHITEM = `
get:
  operationId: listPets
  responses:
    '200':
      description: A list of pets
`;

describe("analyze-document — inline documents", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it("analyzes a single inline document", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [{ filename: "single.yaml", text: SINGLE_DOC, isEntry: true }],
      },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as unknown as AnalyzeOutput;
    expect(structured.documents).toHaveLength(1);
    expect(structured.counts.total).toBe(0);
  });

  it("analyzes a multi-document inline set, resolving the cross-document reference", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "entry.yaml", text: ENTRY_DOC, isEntry: true },
          { filename: "shared.yaml", text: SHARED_DOC, isEntry: false },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as unknown as AnalyzeOutput;
    expect(structured.documents).toHaveLength(2);
    expect(structured.counts.total).toBe(0);
  });

  it("a config override changes pipeline behavior: fragments blocked by default now elicits consent (see mrtr.test.ts), allowed when enabled upfront", async () => {
    // This harness's client declares no `elicitation` capability, so the server's attempt to elicit
    // fragment consent (M4) is rejected before an `input_required` result ever comes back — proving
    // this is now genuinely an elicitation and not a plain load error. The full accept/decline round
    // trip, with a client that does declare the capability, lives in mrtr.test.ts.
    await expect(
      harness.client.callTool({
        name: TOOL_NAMES.analyzeDocument,
        arguments: {
          documents: [
            { filename: "entry.yaml", text: FRAGMENT_ENTRY, isEntry: true },
            { filename: "pathitem.yaml", text: FRAGMENT_PATHITEM, isEntry: false },
          ],
        },
      }),
    ).rejects.toThrow(/capabilit/i);

    const allowed = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "entry.yaml", text: FRAGMENT_ENTRY, isEntry: true },
          { filename: "pathitem.yaml", text: FRAGMENT_PATHITEM, isEntry: false },
        ],
        config: { fragments: "root" },
      },
    });
    expect(allowed.isError).toBeFalsy();
  });

  it("filters by minSeverity", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [{ filename: "single.yaml", text: SINGLE_DOC, isEntry: true }],
        minSeverity: "error",
      },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as unknown as AnalyzeOutput;
    expect(structured.diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("rejects more than MAX_INLINE_DOCS documents before the handler runs", async () => {
    const documents = Array.from({ length: MAX_INLINE_DOCS + 1 }, (_, i) => ({
      filename: `f${i}.yaml`,
      text: "x",
      isEntry: i === 0,
    }));
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: { documents },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects a document over MAX_DOC_CHARS before the handler runs", async () => {
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [{ filename: "big.yaml", text: "a".repeat(MAX_DOC_CHARS + 1), isEntry: true }],
      },
    });
    expect(result.isError).toBe(true);
  });
});
