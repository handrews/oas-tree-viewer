import { describe, it, expect } from "vitest";
import { demos } from "../../src/app/demos";
import { demoDocuments, fixturePath } from "../../src/mcp/documents";
import { bundledFixtures } from "../../src/mcp/fixtures.bundled";

describe("demoDocuments", () => {
  it.each(demos.map((d) => d.id))(
    "sets a bare filename and an absolute retrievalUri for every document in %s",
    async (id) => {
      const docs = await demoDocuments(id, bundledFixtures);
      expect(docs).toBeDefined();
      for (const doc of docs!) {
        expect(doc.filename).not.toContain("/");
        expect(doc.retrievalUri).toBeDefined();
        expect(() => new URL(doc.retrievalUri!)).not.toThrow();
      }
      expect(docs!.filter((d) => d.isEntry)).toHaveLength(1);
    },
  );

  it("returns undefined for an unknown demo id", async () => {
    const docs = await demoDocuments("does-not-exist", bundledFixtures);
    expect(docs).toBeUndefined();
  });
});

describe("fixturePath", () => {
  it("strips the /fixtures/ prefix", () => {
    expect(fixturePath("/fixtures/oads/openapi.yaml")).toBe("oads/openapi.yaml");
  });

  it("rejects a non-fixture URL", () => {
    expect(() => fixturePath("https://example.com/x")).toThrow(/Not a fixture URL/);
  });
});

describe("bundledFixtures", () => {
  it("throws a clear error for an unknown fixture", async () => {
    await expect(bundledFixtures.read("/fixtures/does-not-exist.yaml")).rejects.toThrow(
      /Unknown fixture/,
    );
  });

  it("reads a real fixture's raw text", async () => {
    const text = await bundledFixtures.read("/fixtures/refs-3.1.yaml");
    expect(text).toContain("openapi:");
  });
});
