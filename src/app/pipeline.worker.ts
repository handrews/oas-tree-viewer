// Off-main-thread pipeline worker. The load → buildTree → classify → validate (Hyperjump) → resolve
// pipeline is CPU-bound and synchronous, so running it on the UI thread freezes the tab; this worker
// runs it instead, keeping the page responsive and letting a slow load be aborted by terminating the
// worker. Bootstrap-only — all logic lives in `runPipeline` and the modules it calls.

import type { DocInput } from "../loader";
import type { ViewerConfig } from "./config";
import type { PipelineOptions, PipelineResult } from "./bootstrap";
import { runPipeline } from "./bootstrap";
import { errorMessage } from "../errors";

/** Main thread → worker: run the pipeline for these inputs under this config. */
export interface RunMessage {
  type: "run";
  id: number;
  inputs: DocInput[];
  config: ViewerConfig;
  opts: PipelineOptions;
}

/** Worker → main thread: the pipeline result for a given run id. */
export interface ResultMessage {
  type: "result";
  id: number;
  result: PipelineResult;
}

// In a module worker `self` is the worker global. The app's tsconfig uses the DOM lib (not the
// webworker lib, which would clash), so post replies through a narrow cast rather than the lib type.
const post = (message: ResultMessage): void =>
  (self as unknown as { postMessage(message: ResultMessage): void }).postMessage(message);

self.addEventListener("message", (event: MessageEvent<RunMessage>) => {
  const msg = event.data;
  if (msg.type !== "run") return;
  void (async () => {
    let result: PipelineResult;
    try {
      result = await runPipeline(msg.inputs, msg.config, msg.opts);
    } catch (e) {
      // `runPipeline` already turns expected failures into `{ ok: false, ... }`; this catches the
      // truly unexpected (e.g. a stack overflow on a document admitted past the limits) so the
      // client still hears back instead of hanging.
      result = { ok: false, oadError: errorMessage(e) };
    }
    post({ type: "result", id: msg.id, result });
  })();
});
