// `oas:` resources over the diagnostic catalog and the bundled demo corpus. Every `list` callback
// enumerates a genuinely bounded set (14 diagnostic codes, 12 demos, and their fixed document sets),
// so nothing here needs `list: undefined` — every template's instances are discoverable.

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { demos, demoById } from "../app/demos";
import { diagnosticCatalog } from "../diagnostics/catalog";
import { DIAGNOSTIC_CODES, type DiagnosticCode } from "../diagnostics/types";
import { demoDocuments } from "./documents";
import type { McpDeps } from "./ports";
import {
  CATALOG_DEMOS_URI,
  CATALOG_DIAGNOSTICS_URI,
  demoDocUri,
  demoUri,
  diagnosticUri,
} from "./uris";

/** The one `.json` fixture (if any) among a demo's documents gets `application/json`; every other
 *  fixture is authored as YAML. */
function mimeTypeFor(filename: string): string {
  return filename.endsWith(".json") ? "application/json" : "application/yaml";
}

function isDiagnosticCode(code: string): code is DiagnosticCode {
  return (DIAGNOSTIC_CODES as readonly string[]).includes(code);
}

export function registerResources(server: McpServer, deps: McpDeps): void {
  server.registerResource(
    "diagnostic-catalog",
    CATALOG_DIAGNOSTICS_URI,
    {
      title: "Diagnostic catalog",
      description: "Every diagnostic code the engine can emit, keyed by code.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(diagnosticCatalog()) },
      ],
    }),
  );

  server.registerResource(
    "demo-catalog",
    CATALOG_DEMOS_URI,
    {
      title: "Demo catalog",
      description: "Every bundled demo, with its documents' filenames.",
      mimeType: "application/json",
    },
    async (uri, ctx) => {
      const catalog = await Promise.all(
        demos.map(async (demo) => {
          const docs = await demoDocuments(demo.id, deps.fixtures, ctx.mcpReq.signal);
          return {
            id: demo.id,
            label: demo.label,
            description: demo.description,
            config: demo.config ?? {},
            documents: docs!.map((doc) => doc.filename),
          };
        }),
      );
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(catalog) }],
      };
    },
  );

  server.registerResource(
    "diagnostic",
    new ResourceTemplate(diagnosticUri("{code}"), {
      list: async () => ({
        resources: DIAGNOSTIC_CODES.map((code) => ({
          uri: diagnosticUri(code),
          name: code,
          title: diagnosticCatalog()[code].title,
          mimeType: "text/markdown",
        })),
      }),
      complete: {
        code: (value) => DIAGNOSTIC_CODES.filter((code) => code.startsWith(value)),
      },
    }),
    { title: "Diagnostic", mimeType: "text/markdown" },
    async (uri, { code }) => {
      const codeStr = String(code);
      if (!isDiagnosticCode(codeStr)) throw new Error(`Unknown diagnostic code "${codeStr}".`);
      const entry = diagnosticCatalog()[codeStr];
      const text = `# ${entry.title}\n\n${entry.description}\n\nDefault severity: ${entry.severity}\n`;
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "demo-manifest",
    new ResourceTemplate(demoUri("{demoId}"), {
      list: async () => ({
        resources: demos.map((demo) => ({
          uri: demoUri(demo.id),
          name: demo.id,
          title: demo.label,
          mimeType: "application/json",
        })),
      }),
      complete: {
        demoId: (value) => demos.map((demo) => demo.id).filter((id) => id.startsWith(value)),
      },
    }),
    { title: "Demo manifest", mimeType: "application/json" },
    async (uri, { demoId }, ctx) => {
      const demo = demoById(String(demoId));
      if (!demo) throw new Error(`Unknown demo "${String(demoId)}".`);
      const docs = await demoDocuments(demo.id, deps.fixtures, ctx.mcpReq.signal);
      const manifest = {
        id: demo.id,
        label: demo.label,
        description: demo.description,
        config: demo.config ?? {},
        documents: docs!.map((doc) => ({
          filename: doc.filename,
          isEntry: doc.isEntry,
          retrievalUri: doc.retrievalUri,
        })),
      };
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(manifest) }],
      };
    },
  );

  server.registerResource(
    "demo-document",
    new ResourceTemplate(demoDocUri("{demoId}", "{filename}"), {
      list: async (ctx) => {
        const perDemo = await Promise.all(
          demos.map(async (demo) => {
            const docs = await demoDocuments(demo.id, deps.fixtures, ctx.mcpReq.signal);
            return docs!.map((doc) => ({
              uri: demoDocUri(demo.id, doc.filename),
              name: doc.filename,
              title: `${demo.id}/${doc.filename}`,
              mimeType: mimeTypeFor(doc.filename),
            }));
          }),
        );
        return { resources: perDemo.flat() };
      },
      complete: {
        demoId: (value) => demos.map((demo) => demo.id).filter((id) => id.startsWith(value)),
        // Scoped by the already-chosen demoId, so completing a filename only offers documents that
        // demo actually has — the point of the two-argument completion form.
        filename: async (value, context) => {
          const demoId = context?.arguments?.demoId;
          if (!demoId) return [];
          const docs = await demoDocuments(demoId, deps.fixtures);
          if (!docs) return [];
          return docs.map((doc) => doc.filename).filter((filename) => filename.startsWith(value));
        },
      },
    }),
    { title: "Demo document", mimeType: "application/yaml" },
    async (uri, { demoId, filename }, ctx) => {
      const docs = await demoDocuments(String(demoId), deps.fixtures, ctx.mcpReq.signal);
      const doc = docs?.find((d) => d.filename === String(filename));
      if (!doc)
        throw new Error(`Unknown document "${String(filename)}" in demo "${String(demoId)}".`);
      return { contents: [{ uri: uri.href, mimeType: mimeTypeFor(doc.filename), text: doc.text }] };
    },
  );
}
