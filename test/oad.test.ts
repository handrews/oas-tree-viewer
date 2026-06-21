import { describe, it, expect } from "vitest";
import { assembleOad } from "../src/oad";
import { DuplicateOperationIdError, VersionMismatchError } from "../src/errors";
import { makeDoc } from "./helpers";

const doc = (version: string) => `openapi: ${version}\ninfo: { title: T, version: '1' }\npaths: {}\n`;

/** A 3.2 document whose Operations declare the given operationIds, one per generated path. */
const opsDoc = (...operationIds: string[]) =>
  `openapi: 3.2.0\ninfo: { title: T, version: '1' }\npaths:\n` +
  operationIds
    .map(
      (id, i) =>
        `  /p${i}:\n    get:\n      operationId: ${id}\n      responses: { '200': { description: OK } }\n`,
    )
    .join("");

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

  it("accepts unique operationIds across the OAD", async () => {
    const entry = await makeDoc(opsDoc("getA", "getB"), { isEntry: true });
    const extra = await makeDoc(opsDoc("getC"));
    expect(() => assembleOad([entry, extra])).not.toThrow();
  });

  it("rejects two Operations sharing an operationId in the same document", async () => {
    const entry = await makeDoc(opsDoc("dup", "dup"), { isEntry: true });
    expect(() => assembleOad([entry])).toThrow(DuplicateOperationIdError);
  });

  it("rejects an operationId duplicated across two documents, unique within each", async () => {
    const entry = await makeDoc(opsDoc("shared"), { isEntry: true });
    const extra = await makeDoc(opsDoc("shared"));
    expect(() => assembleOad([entry, extra])).toThrow(DuplicateOperationIdError);
  });
});
