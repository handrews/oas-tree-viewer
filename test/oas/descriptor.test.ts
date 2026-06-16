import { describe, it, expect } from "vitest";
import { buildDescriptors } from "../../src/oas/descriptor";

describe("buildDescriptors", () => {
  it("describes the shared grammar", () => {
    const d = buildDescriptors("3.1");
    expect(d.OpenApi.fields?.paths).toEqual({ value: "Paths" });
    expect(d.Components.fields?.schemas).toEqual({ map: "Schema" });
    expect(d.PathItem.fields?.get).toEqual({ value: "Operation" });
    expect(d.Responses.mapOf).toBe("Response");
  });

  it("adds 3.2-only fields", () => {
    const v31 = buildDescriptors("3.1");
    const v32 = buildDescriptors("3.2");
    expect(v31.Components.fields?.mediaTypes).toBeUndefined();
    expect(v32.Components.fields?.mediaTypes).toEqual({ map: "MediaType" });
    expect(v31.PathItem.fields?.query).toBeUndefined();
    expect(v32.PathItem.fields?.query).toEqual({ value: "Operation" });
    expect(v32.PathItem.fields?.additionalOperations).toEqual({ map: "Operation" });
  });
});
