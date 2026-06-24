import { expect, test } from "vitest";
import { bigOadText, countNodes, dimsFor, makeBigOad } from "./bigTree";

test("bigOadText emits an OpenAPI 3.1 document with the requested schemas and properties", () => {
  const doc = JSON.parse(bigOadText(2, 3)) as {
    openapi: string;
    components: { schemas: Record<string, { properties: Record<string, unknown> }> };
  };
  expect(doc.openapi).toMatch(/^3\.1/);
  expect(Object.keys(doc.components.schemas)).toHaveLength(2);
  expect(Object.keys(doc.components.schemas.S0!.properties)).toHaveLength(3);
});

test("dimsFor lands near the target node count and keeps the requested branching", () => {
  const { schemas, branching } = dimsFor(1000, 24);
  expect(branching).toBe(24);
  const approx = schemas * (2 * branching + 3);
  expect(approx).toBeGreaterThan(900);
  expect(approx).toBeLessThan(1100);
});

test("makeBigOad builds a real Oad of approximately the requested size", async () => {
  const oad = await makeBigOad(300);
  expect(oad.documents).toHaveLength(1);
  const n = countNodes(oad.documents[0]!.root);
  expect(n).toBeGreaterThan(200);
  expect(n).toBeLessThan(400);
});
