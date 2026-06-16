import { describe, it, expect } from "vitest";
import { assembleOad } from "../src/oad";
import { VersionMismatchError } from "../src/errors";
import { makeDoc } from "./helpers";

const doc = (version: string) => `openapi: ${version}\ninfo: { title: T, version: '1' }\npaths: {}\n`;

describe("assembleOad", () => {
  it("accepts a single document and sets the version family", async () => {
    const d = await makeDoc(doc("3.1.0"), { isEntry: true });
    const oad = assembleOad([d]);
    expect(oad.versionFamily).toBe("3.1");
    expect(oad.documents).toHaveLength(1);
  });

  it("preserves caller order, treating the first document as the entry", async () => {
    const entry = await makeDoc(doc("3.1.0"), { isEntry: true });
    const extra = await makeDoc(doc("3.1.0"));
    const oad = assembleOad([entry, extra]);
    expect(oad.documents.map((d) => d.isEntry)).toEqual([true, false]);
  });

  it("detects the 3.2 family", async () => {
    const d = await makeDoc(doc("3.2.0"), { isEntry: true });
    expect(assembleOad([d]).versionFamily).toBe("3.2");
  });

  it("rejects mixing 3.1 and 3.2", async () => {
    const a = await makeDoc(doc("3.1.0"), { isEntry: true });
    const b = await makeDoc(doc("3.2.0"));
    expect(() => assembleOad([a, b])).toThrow(VersionMismatchError);
  });
});
