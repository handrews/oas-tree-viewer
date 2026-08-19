// Reproduces, for a demo, what `detectDocument`'s URL branch derives in the browser — filename from
// the fetch URL's last path segment, and a base URI to resolve relative sibling references against —
// without calling `detectDocument` itself (which wants a real `fetch` and, on its upload branch, a
// DOM `self.location`). See src/loader.ts for the derivations this must match.

import type { DocInput } from "../loader";
import { demoInputs } from "../app/demos";
import type { FixtureSource } from "./ports";

/** One inline document, in the shape the pipeline's upload branch and the tool's `documents[]`
 *  input both use. */
export interface InlineDoc {
  filename: string;
  text: string;
  retrievalUri?: string;
  isEntry: boolean;
}

/** Strip the prefix a `fixtureUrl()`-shaped URL always carries, back to the path a `FixtureSource`
 *  is keyed on. The prefix is `BASE_URL`-derived to match `fixtureUrl()` exactly: the base is "/" in
 *  dev and in the Node build (pinned by vite.mcp.config.ts), but a sub-path like "/projects/oas/" in
 *  the deployed site. */
export function fixturePath(url: string): string {
  const prefix = `${import.meta.env.BASE_URL}fixtures/`;
  if (!url.startsWith(prefix)) throw new Error(`Not a fixture URL: ${url}`);
  return url.slice(prefix.length);
}

// Host-independent stand-in base URI for a demo document that pins no `retrievalUri` of its own.
// Arbitrary, but must be the same across hosts so a demo's sibling references resolve identically
// whether it is analyzed from Node or (later) the browser.
const SYNTHETIC_BASE = "https://demos.oas-tree-viewer.invalid/fixtures/";

/**
 * The document set for a demo, with text read through `src`. `undefined` for an unknown demo id.
 *
 * `retrievalUri` is always set explicitly, even when the demo pins none of its own: `toInputs` takes
 * every document through the pipeline's *upload* branch (src/loader.ts), where an explicit
 * `retrievalUri` wins over the `file://` fallback built from the filename — so the "self" demo
 * (which pins nothing) resolves its `oads/`-relative siblings against this synthetic base instead of
 * a bare `file:///openapi.yaml`, which would break them.
 */
export async function demoDocuments(
  id: string,
  src: FixtureSource,
  signal?: AbortSignal,
  // Fires once a document's text is in hand, before the next one is read — the seam analyze.ts uses
  // for per-document progress, kept here rather than duplicating this loop so there is still exactly
  // one place that builds a demo's InlineDoc[].
  onRead?: (doc: InlineDoc) => void | Promise<void>,
): Promise<InlineDoc[] | undefined> {
  const inputs = demoInputs(id);
  if (!inputs) return undefined;

  const docs: InlineDoc[] = [];
  for (const input of inputs) {
    // Every demo's inputs are fixture URLs (src/app/demos.ts); nothing here can be an upload input.
    if (input.source !== "url") {
      throw new Error(`Demo "${id}" has a non-URL input, which demoDocuments cannot resolve.`);
    }
    const path = fixturePath(input.url);
    const text = await src.read(input.url, signal);
    const filename = path.split("/").pop()!;
    const retrievalUri = input.retrievalUri ?? new URL(path, SYNTHETIC_BASE).href;
    const doc: InlineDoc = { filename, text, retrievalUri, isEntry: input.isEntry };
    docs.push(doc);
    await onRead?.(doc);
  }
  return docs;
}

/** Materialize a document set as pipeline input, taking the upload branch for every document (see
 *  `demoDocuments` for why that matters). */
export function toInputs(docs: InlineDoc[]): DocInput[] {
  return docs.map((d) => ({
    source: "upload",
    filename: d.filename,
    text: d.text,
    retrievalUri: d.retrievalUri,
    isEntry: d.isEntry,
  }));
}
