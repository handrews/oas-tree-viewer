import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { demos } from "../../src/app/demos";
import { demoDocuments } from "../../src/mcp/documents";
import { bundledFixtures } from "../../src/mcp/fixtures.bundled";
import { diagnosticCatalog } from "../../src/diagnostics/catalog";
import { DIAGNOSTIC_CODES } from "../../src/diagnostics/types";
import {
  CATALOG_DEMOS_URI,
  CATALOG_DIAGNOSTICS_URI,
  demoDocUri,
  demoUri,
  diagnosticUri,
} from "../../src/mcp/uris";
import { connectTestClient, closeTestClient, type TestHarness } from "./testHarness";

async function totalDemoDocuments(): Promise<number> {
  const counts = await Promise.all(
    demos.map(async (demo) => (await demoDocuments(demo.id, bundledFixtures))!.length),
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

describe("resources", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await connectTestClient();
  });

  afterEach(async () => {
    await closeTestClient(harness);
  });

  it("lists the two static resources plus every template instance", async () => {
    const { resources } = await harness.client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    const total = 2 + DIAGNOSTIC_CODES.length + demos.length + (await totalDemoDocuments());
    expect(uris).toHaveLength(total);
    expect(uris).toContain(CATALOG_DIAGNOSTICS_URI);
    expect(uris).toContain(CATALOG_DEMOS_URI);
  });

  it("lists exactly the three resource templates", async () => {
    const { resourceTemplates } = await harness.client.listResourceTemplates();
    const patterns = resourceTemplates.map((t) => t.uriTemplate).sort();
    expect(patterns).toEqual(
      [diagnosticUri("{code}"), demoUri("{demoId}"), demoDocUri("{demoId}", "{filename}")].sort(),
    );
  });

  it("reads the diagnostic catalog verbatim", async () => {
    const { contents } = await harness.client.readResource({ uri: CATALOG_DIAGNOSTICS_URI });
    const text = (contents[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual(diagnosticCatalog());
  });

  it("reads the demo catalog with every demo's document filenames", async () => {
    const { contents } = await harness.client.readResource({ uri: CATALOG_DEMOS_URI });
    const text = (contents[0] as { text: string }).text;
    const catalog = JSON.parse(text) as Array<{ id: string; documents: string[] }>;
    expect(catalog).toHaveLength(demos.length);
    for (const demo of demos) {
      const docs = await demoDocuments(demo.id, bundledFixtures);
      const entry = catalog.find((c) => c.id === demo.id);
      expect(entry?.documents).toEqual(docs!.map((d) => d.filename));
    }
  });

  it.each(DIAGNOSTIC_CODES)("reads one diagnostic as markdown for %s", async (code) => {
    const { contents } = await harness.client.readResource({ uri: diagnosticUri(code) });
    expect(contents[0]).toMatchObject({ mimeType: "text/markdown" });
    const text = (contents[0] as { text: string }).text;
    expect(text).toContain(diagnosticCatalog()[code].title);
  });

  it("rejects an unknown diagnostic code", async () => {
    await expect(
      harness.client.readResource({ uri: diagnosticUri("not-a-real-code") }),
    ).rejects.toThrow();
  });

  it.each(demos.map((d) => d.id))(
    "reads demo %s's manifest with exactly one entry document",
    async (id) => {
      const { contents } = await harness.client.readResource({ uri: demoUri(id) });
      const text = (contents[0] as { text: string }).text;
      const manifest = JSON.parse(text) as {
        id: string;
        documents: Array<{ filename: string; isEntry: boolean }>;
      };
      expect(manifest.id).toBe(id);
      expect(manifest.documents.filter((d) => d.isEntry)).toHaveLength(1);
    },
  );

  it("rejects an unknown demo manifest", async () => {
    await expect(harness.client.readResource({ uri: demoUri("does-not-exist") })).rejects.toThrow();
  });

  it("reads a demo document's raw text through the same fixture port", async () => {
    const docs = await demoDocuments("refs", bundledFixtures);
    const doc = docs![0];
    const { contents } = await harness.client.readResource({
      uri: demoDocUri("refs", doc.filename),
    });
    expect(contents[0]).toMatchObject({ text: doc.text });
  });

  it("rejects an unknown document in a known demo", async () => {
    await expect(
      harness.client.readResource({ uri: demoDocUri("refs", "does-not-exist.yaml") }),
    ).rejects.toThrow();
  });
});
