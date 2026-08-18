// Process entry: serves the two tools over stdio for a local MCP host (Claude Code, Claude
// Desktop, the Inspector). Excluded from coverage (see vitest.config.ts) — bootstrap wiring, the
// same reason src/app/pipeline.worker.ts is excluded.

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "../server";
import { bundledFixtures } from "../fixtures.bundled";

const handle = serveStdio(() =>
  createServer({ fixtures: bundledFixtures, version: __APP_VERSION__ }),
);

// stdout is the JSON-RPC channel; readiness (and everything else) is logged to stderr.
console.error(`oas-structure-viewer MCP server listening on stdio (v${__APP_VERSION__})`);

process.on("SIGINT", () => {
  void handle.close();
});
