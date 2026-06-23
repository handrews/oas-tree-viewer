import { describe, it, expect } from "vitest";
import { demos, demoById, demoInputs } from "../../src/app/demos";

describe("demos", () => {
  it("every demo has a unique id, a label, a description, and an entry document", () => {
    const ids = new Set<string>();
    for (const d of demos) {
      expect(d.label).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      const entries = d.inputs.filter((i) => i.isEntry);
      expect(entries).toHaveLength(1);
      expect(d.inputs[0]!.isEntry).toBe(true); // entry first
    }
  });

  it("loads documents as same-origin fixture URLs (no CORS)", () => {
    for (const d of demos) {
      for (const input of d.inputs) {
        expect(input.source).toBe("url");
        expect(input.source === "url" && input.url.startsWith("/fixtures/")).toBe(true);
      }
    }
  });

  it("demoById / demoInputs resolve known ids and reject unknown ones", () => {
    expect(demoById("refs")?.id).toBe("refs");
    expect(demoInputs("refs")).toEqual([
      {
        source: "url",
        url: "/fixtures/refs-3.1.yaml",
        isEntry: true,
        retrievalUri: "https://example.com/oad/entry.yaml",
      },
      {
        source: "url",
        url: "/fixtures/refs-shared-3.1.yaml",
        isEntry: false,
        retrievalUri: "https://example.com/oad/shared.yaml",
      },
    ]);
    expect(demoById("nope")).toBeUndefined();
    expect(demoInputs("nope")).toBeUndefined();
  });

  it("includes the refs, $self, component-name, operation, operationId, $dynamicRef, $recursiveRef, numbered-drafts, dialects, standalone-JSON-Schema, and fragment demos", () => {
    expect(demos.map((d) => d.id)).toEqual([
      "refs",
      "self",
      "component-refs",
      "operation-refs",
      "operationid",
      "dynamicref",
      "recursiveref",
      "numbered-drafts",
      "dialects",
      "jsonschema",
      "fragment",
    ]);
    expect(demoInputs("self")![0]!).toMatchObject({ url: "/fixtures/oads/openapi.yaml", isEntry: true });
    expect(demoInputs("component-refs")![0]!).toMatchObject({
      url: "/fixtures/component-refs-3.2.yaml",
      isEntry: true,
    });
    expect(demoInputs("operation-refs")![0]!).toMatchObject({
      url: "/fixtures/operation-refs-3.2.yaml",
      isEntry: true,
    });
    expect(demoInputs("operationid")).toEqual([
      { source: "url", url: "/fixtures/operationid-3.2.yaml", isEntry: true },
      { source: "url", url: "/fixtures/operationid-shared-3.2.yaml", isEntry: false },
      { source: "url", url: "/fixtures/operationid-remote-3.2.yaml", isEntry: false },
    ]);
    expect(demoInputs("dynamicref")![0]!).toMatchObject({
      url: "/fixtures/dynamicref-3.1.yaml",
      isEntry: true,
    });
    expect(demoInputs("recursiveref")).toEqual([
      { source: "url", url: "/fixtures/recursiveref-3.1.yaml", isEntry: true },
    ]);
    expect(demoInputs("numbered-drafts")).toEqual([
      { source: "url", url: "/fixtures/numbered-drafts-3.1.yaml", isEntry: true },
    ]);
    // The fragment demo enables fragments via a per-demo config override.
    expect(demoById("fragment")?.config).toEqual({ allowFragments: true });
    expect(demoInputs("fragment")).toEqual([
      {
        source: "url",
        url: "/fixtures/ref-to-fragment-3.1.yaml",
        isEntry: true,
        retrievalUri: "https://example.com/oad/ref-to-fragment-3.1.yaml",
      },
      {
        source: "url",
        url: "/fixtures/pet-pathitem-3.1.yaml",
        isEntry: false,
        retrievalUri: "https://example.com/oad/pet-pathitem-3.1.yaml",
      },
    ]);
  });
});
