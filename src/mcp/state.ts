// Cross-round memory for the two MRTR flows in `analyze-document` (server.ts). `inputResponses`
// only ever carries the LATEST round's answers — once the entry round is answered, that answer is
// gone from the wire by the time a later round asks about fragments — so a flow that chains two
// elicitations has to carry what it already learned forward itself. `requestState` is the only
// channel for that, and it round-trips through the client as attacker-controlled input, so it is
// minted and read through the SDK's HMAC codec rather than trusted as-is. It carries the *decision*
// (a chosen filename), never document payload — the client re-sends the original tool `arguments`
// verbatim on every retry, so there is nothing here `analyze.ts` couldn't already reach that way.
//
// `createMcpHandler`'s factory constructs a fresh `McpServer` once per HTTP request (see server.ts),
// so a key minted inside `createServer` would differ between the round that mints a token and the
// round that verifies it. Minting it once here, at module load, keeps it stable for the lifetime of
// whichever process imports this module — exactly the "one process serves every round" case the
// codec's own docs call out as the situation a per-process random key is sufficient for.

import { createRequestStateCodec, type RequestStateCodec } from "@modelcontextprotocol/server";

/** Which question `analyze-document` is still waiting on, and — once the flow has moved on to a
 *  second question — what an earlier round already resolved. `entry` is absent when the entry round
 *  never ran (a fragments-only flow never needed it). */
export type AnalyzeState =
  | { phase: "awaiting-entry" }
  | { phase: "awaiting-fragments"; entry?: string };

const STATE_KEY_BYTES = 32;

export const analyzeStateCodec: RequestStateCodec<AnalyzeState> =
  createRequestStateCodec<AnalyzeState>({
    key: crypto.getRandomValues(new Uint8Array(STATE_KEY_BYTES)),
    // Generous relative to a human answering an elicitation prompt, stingy relative to an attacker
    // replaying a captured token.
    ttlSeconds: 600,
  });
