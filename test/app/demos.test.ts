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
      { source: "url", url: "/fixtures/refs-3.1.yaml", isEntry: true },
      { source: "url", url: "/fixtures/refs-shared-3.1.yaml", isEntry: false },
    ]);
    expect(demoById("nope")).toBeUndefined();
    expect(demoInputs("nope")).toBeUndefined();
  });

  it("includes the refs, $self, component-name, and operation reference demos", () => {
    expect(demos.map((d) => d.id)).toEqual(["refs", "self", "component-refs", "operation-refs"]);
    expect(demoInputs("self")![0]!).toMatchObject({ url: "/fixtures/oads/openapi.yaml", isEntry: true });
    expect(demoInputs("component-refs")![0]!).toMatchObject({
      url: "/fixtures/component-refs-3.2.yaml",
      isEntry: true,
    });
    expect(demoInputs("operation-refs")![0]!).toMatchObject({
      url: "/fixtures/operation-refs-3.2.yaml",
      isEntry: true,
    });
  });
});
