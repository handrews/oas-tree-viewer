import { expect, test } from "vitest";
import { PipelineCancelled, PipelineClient } from "../../src/app/pipelineClient";
import { runPipeline } from "../../src/app/bootstrap";
import { defaultConfig } from "../../src/app/config";
import type { DocInput } from "../../src/loader";

// The PipelineClient runs the real pipeline in a module Web Worker. These specs need a real worker
// (and the worker's Hyperjump validation), so they live in the browser project, not the node one.

// A complete OAS 3.1 document with one internal $ref, so the pipeline validates (exercising Hyperjump
// inside the worker) and produces exactly one resolved reference edge.
const DOC = `
openapi: 3.1.0
info: { title: T, version: '1' }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          $ref: '#/components/responses/OK'
components:
  responses:
    OK: { description: ok }
  schemas:
    Pet: { type: object }
`;

const upload: DocInput = { source: "upload", filename: "openapi.yaml", text: DOC, isEntry: true };

test("run() returns the same result off-thread as runPipeline does directly", async () => {
  const client = new PipelineClient();
  const direct = await runPipeline([upload], defaultConfig);
  const viaWorker = await client.run([upload], defaultConfig);

  expect(direct.ok).toBe(true);
  expect(viaWorker.ok).toBe(true);
  if (!direct.ok || !viaWorker.ok) return; // narrow the result union

  // The Oad and ResolvedRefs survive structured-clone across the worker boundary identically.
  expect(viaWorker.oad.documents.length).toBe(direct.oad.documents.length);
  expect(viaWorker.oad.versionFamily).toBe(direct.oad.versionFamily);
  expect(viaWorker.refs.edges.length).toBe(direct.refs.edges.length);
  expect(viaWorker.refs.edges.length).toBeGreaterThan(0);
  // The bySource/byTarget indexes are Maps — proving Maps clone, not just plain objects.
  expect(viaWorker.refs.bySource).toBeInstanceOf(Map);
  expect(viaWorker.refs.byTarget).toBeInstanceOf(Map);
});

test("cancel() aborts the in-flight run, and the client still works afterwards", async () => {
  const client = new PipelineClient();
  const pending = client.run([upload], defaultConfig);
  client.cancel(); // terminate before the worker can reply

  await expect(pending).rejects.toBeInstanceOf(PipelineCancelled);

  // A fresh worker is spawned for the next run, which succeeds.
  const after = await client.run([upload], defaultConfig);
  expect(after.ok).toBe(true);
});
