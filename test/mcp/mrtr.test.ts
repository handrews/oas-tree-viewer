import { describe, it, expect, afterEach } from "vitest";
import type { ElicitResult } from "@modelcontextprotocol/client";
import { TOOL_NAMES } from "../../src/mcp/info";
import type { AnalyzeOutput } from "../../src/mcp/schemas";
import { connectMrtrClient, closeTestClient, type MrtrHarness } from "./testHarness";

// A bare Path Item Object fragment (no openapi/$id/$schema) — loads only with document fragments
// enabled, referenced at its root by ENTRY so `fragments: "root"` genuinely resolves it (not just
// tolerates it unreachable, which `fragments: "any"` would paper over).
const ENTRY = `
openapi: 3.0.4
info: { title: Entry, version: "1.0" }
paths:
  /pets:
    $ref: pathitem.yaml
`;
const PATHITEM = `
get:
  operationId: listPets
  responses:
    '200':
      description: ok
`;
// A second, equally-valid entry candidate — paired with ENTRY (both isEntry: true) to make the
// entry ambiguous without touching the fragment scenario above.
const OTHER_ENTRY = `
openapi: 3.0.4
info: { title: Other, version: "1.0" }
paths: {}
`;

function isElicitRequest(params: {
  requestedSchema: unknown;
}): params is { requestedSchema: { properties: Record<string, unknown> } } {
  return typeof params.requestedSchema === "object" && params.requestedSchema !== null;
}

/** True when this elicitation's schema is asking about `key` (`"entry"` or `"fragments"`) — lets one
 *  handler serve both questions by inspecting what was actually asked, the same way ElicitPanel would. */
function asks(params: { requestedSchema: unknown }, key: string): boolean {
  return isElicitRequest(params) && key in params.requestedSchema.properties;
}

describe("analyze-document — MRTR (fragment consent, ambiguous entry)", () => {
  let harness: MrtrHarness | undefined;

  afterEach(async () => {
    if (harness) await closeTestClient(harness);
    harness = undefined;
  });

  it("fragment consent: accept resumes the load, as two tools/call exchanges with different ids and no requestState (single-round flow)", async () => {
    harness = await connectMrtrClient((): ElicitResult => ({
      action: "accept",
      content: { fragments: "root" },
    }));
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "entry.yaml", text: ENTRY, isEntry: true },
          { filename: "pathitem.yaml", text: PATHITEM, isEntry: false },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as unknown as AnalyzeOutput;
    expect(structured.documents).toHaveLength(2);

    const calls = harness.exchanges.filter((e) => e.method === "tools/call");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
    expect(calls[1]!.params.inputResponses).toMatchObject({
      fragments: { action: "accept", content: { fragments: "root" } },
    });
    expect(calls[1]!.params.requestState).toBeUndefined();
  });

  it("fragment consent: decline resumes as a normal (non-error) result explaining the refusal and the config override", async () => {
    harness = await connectMrtrClient((): ElicitResult => ({ action: "decline" }));
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "entry.yaml", text: ENTRY, isEntry: true },
          { filename: "pathitem.yaml", text: PATHITEM, isEntry: false },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^Declined:/);
    expect(text).toContain("config");
    expect(text).toContain("fragments");
  });

  it("fragment consent: cancel resumes as a normal (non-error) result too", async () => {
    harness = await connectMrtrClient((): ElicitResult => ({ action: "cancel" }));
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "entry.yaml", text: ENTRY, isEntry: true },
          { filename: "pathitem.yaml", text: PATHITEM, isEntry: false },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    expect((result.content[0] as { text: string }).text).toMatch(/^Cancelled:/);
  });

  it("ambiguous entry: accept picks the named document as the entry", async () => {
    harness = await connectMrtrClient((): ElicitResult => ({
      action: "accept",
      content: { entry: "b.yaml" },
    }));
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "a.yaml", text: OTHER_ENTRY, isEntry: true },
          { filename: "b.yaml", text: OTHER_ENTRY, isEntry: true },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as unknown as AnalyzeOutput;
    expect(structured.documents.find((d) => d.isEntry)?.label).toBe("b.yaml");

    const calls = harness.exchanges.filter((e) => e.method === "tools/call");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
  });

  it("ambiguous entry: zero isEntry: true also elicits, over the same 'entry' key", async () => {
    harness = await connectMrtrClient((): ElicitResult => ({
      action: "accept",
      content: { entry: "a.yaml" },
    }));
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [{ filename: "a.yaml", text: OTHER_ENTRY, isEntry: false }],
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as unknown as AnalyzeOutput;
    expect(structured.documents[0]?.isEntry).toBe(true);
  });

  it("ambiguous entry: decline explains the refusal in terms of documents[].isEntry, not isError", async () => {
    harness = await connectMrtrClient((): ElicitResult => ({ action: "decline" }));
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "a.yaml", text: OTHER_ENTRY, isEntry: true },
          { filename: "b.yaml", text: OTHER_ENTRY, isEntry: true },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^Declined:/);
    expect(text).toContain("isEntry");
  });

  it("chains entry then fragment consent in one call, carrying the entry decision in requestState", async () => {
    harness = await connectMrtrClient((params): ElicitResult => {
      if (asks(params, "entry")) return { action: "accept", content: { entry: "a.yaml" } };
      return { action: "accept", content: { fragments: "root" } };
    });
    const result = await harness.client.callTool({
      name: TOOL_NAMES.analyzeDocument,
      arguments: {
        documents: [
          { filename: "a.yaml", text: ENTRY, isEntry: true },
          { filename: "b.yaml", text: OTHER_ENTRY, isEntry: true },
          { filename: "pathitem.yaml", text: PATHITEM, isEntry: false },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as unknown as AnalyzeOutput;
    expect(structured.documents.find((d) => d.isEntry)?.label).toBe("a.yaml");
    expect(structured.documents).toHaveLength(3);

    const calls = harness.exchanges.filter((e) => e.method === "tools/call");
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.id)).size).toBe(3);
    // Round 2 (asking about fragments) mints requestState carrying the entry decision forward —
    // round 3's inputResponses only ever holds "fragments", not "entry" (see state.ts).
    expect(calls[1]!.params.inputResponses).toMatchObject({ entry: { action: "accept" } });
    const round3RequestState = calls[2]!.params.requestState;
    expect(typeof round3RequestState).toBe("string");
    // The codec's documented wire shape (state.ts / createRequestStateCodec): "v1." + payload + "." +
    // mac, both base64url — opaque in the sense that nothing here is plain JSON on the wire, though the
    // codec is signed rather than encrypted (a client could decode the payload segment itself).
    expect(round3RequestState as string).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
  });

  it("rejects a tampered requestState with the frozen -32602, never reaching the handler", async () => {
    harness = await connectMrtrClient((params): ElicitResult => {
      if (asks(params, "entry")) return { action: "accept", content: { entry: "a.yaml" } };
      return { action: "accept", content: { fragments: "root" } };
    });
    const args = {
      documents: [
        { filename: "a.yaml", text: ENTRY, isEntry: true },
        { filename: "b.yaml", text: OTHER_ENTRY, isEntry: true },
        { filename: "pathitem.yaml", text: PATHITEM, isEntry: false },
      ],
    };
    await harness.client.callTool({ name: TOOL_NAMES.analyzeDocument, arguments: args });
    const capturedState = harness.exchanges.filter((e) => e.method === "tools/call")[2]!.params
      .requestState as string;
    expect(capturedState).toBeDefined();

    // Flip one character in the middle of the MAC segment (not the last character: base64url's final
    // character of a 256-bit digest carries two padding bits, so flipping only *it* can decode to the
    // same bytes and leave the MAC valid — a false negative for this test).
    const macStart = capturedState.lastIndexOf(".") + 1;
    const flipAt = macStart + 5;
    const flipped = capturedState[flipAt] === "A" ? "B" : "A";
    const tampered = capturedState.slice(0, flipAt) + flipped + capturedState.slice(flipAt + 1);

    await expect(
      harness.client.request({
        method: "tools/call",
        params: {
          name: TOOL_NAMES.analyzeDocument,
          arguments: args,
          inputResponses: { fragments: { action: "accept", content: { fragments: "root" } } },
          requestState: tampered,
        },
      }),
    ).rejects.toThrow(/Invalid or expired requestState/);
  });
});
