// Process entry: serves the same registrations as hosts/stdio.ts over Streamable HTTP, for a local
// MCP host that talks HTTP instead of launching a child process. Loopback-only: `toNodeHandler`'s
// handler validates neither `Host` nor `Origin` itself, so both guards run in front of it — on a
// localhost bind, the `Host` check is what stops DNS rebinding. Excluded from coverage (see
// vitest.config.ts) — bootstrap + listen wiring, the same reason hosts/stdio.ts is excluded.

import { createServer as createHttpServer } from "node:http";
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from "@modelcontextprotocol/node";
import { createHandler } from "../server";
import { bundledFixtures } from "../fixtures.bundled";

const PORT = Number(process.env.PORT ?? 3939);

const handler = createHandler({ fixtures: bundledFixtures, version: __APP_VERSION__ });
const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const httpServer = createHttpServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void nodeHandler(req, res);
});

httpServer.listen(PORT, "127.0.0.1", () => {
  // Readiness (and everything else) is logged to stderr, matching hosts/stdio.ts — nothing about an
  // HTTP server needs stdout kept clean, but one convention across both hosts is easier to remember.
  console.error(
    `oas-structure-viewer MCP server listening on http://127.0.0.1:${PORT}/mcp (v${__APP_VERSION__})`,
  );
});

process.on("SIGINT", () => {
  httpServer.close();
  void handler.close();
});
