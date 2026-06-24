// Runs the OAD pipeline in a Web Worker (see pipeline.worker.ts) so the UI thread stays responsive
// during a load, and so a slow load can be cancelled. A single persistent worker is reused between
// runs — keeping the validator's lazily-imported Hyperjump schema chunks warm — and `cancel()`
// terminates it (the only way to actually stop the synchronous CPU work mid-flight); the next run
// spawns a fresh worker.

import type { DocInput } from "../loader";
import type { ViewerConfig } from "./config";
import type { PipelineOptions, PipelineResult } from "./bootstrap";
import type { ResultMessage, RunMessage } from "./pipeline.worker";

/** Rejection raised when a run is aborted by {@link PipelineClient.cancel}, so a caller can tell a
 *  user-initiated cancel apart from a genuine pipeline failure. */
export class PipelineCancelled extends Error {
  constructor() {
    super("Pipeline run cancelled.");
    this.name = "PipelineCancelled";
  }
}

interface Pending {
  id: number;
  resolve: (result: PipelineResult) => void;
  reject: (reason: unknown) => void;
}

export class PipelineClient {
  private worker: Worker | null = null;
  private nextId = 1;
  /** The single in-flight run. The UI never starts a second run before the first settles or is
   *  cancelled, so one slot suffices. */
  private pending: Pending | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./pipeline.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<ResultMessage>) => {
      const msg = event.data;
      if (msg.type !== "result" || this.pending?.id !== msg.id) return;
      const { resolve } = this.pending;
      this.pending = null;
      resolve(msg.result);
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      if (!this.pending) return;
      const { reject } = this.pending;
      this.pending = null;
      reject(new Error(event.message || "The pipeline worker failed unexpectedly."));
    });
    this.worker = worker;
    return worker;
  }

  /** Run the pipeline off-thread. Resolves with the {@link PipelineResult}; rejects with
   *  {@link PipelineCancelled} if {@link cancel} is called before it finishes. */
  run(inputs: DocInput[], config: ViewerConfig, opts: PipelineOptions = {}): Promise<PipelineResult> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<PipelineResult>((resolve, reject) => {
      this.pending = { id, resolve, reject };
      const msg: RunMessage = { type: "run", id, inputs, config, opts };
      worker.postMessage(msg);
    });
  }

  /** Abort the in-flight run, if any: terminate the worker so its CPU work actually stops, and reject
   *  the pending promise. The next {@link run} spawns a fresh worker. */
  cancel(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = null;
      reject(new PipelineCancelled());
    }
  }
}

/** Shared client used by the pages (mirrors the app's other runtime singletons). */
export const pipelineClient = new PipelineClient();
