import { describe, it, expect, vi, afterEach } from "vitest";
import { buildTree } from "../src/model/treeBuilder";
import { detectDocument, type DocInput } from "../src/loader";
import { runPipeline } from "../src/app/bootstrap";
import { ResourceLimitError } from "../src/errors";
import { formatBytes, type Limits } from "../src/limits";
import { makeInput } from "./helpers";

// Resource guards refuse an oversized / over-deep document up front, but stay liftable so a determined
// user can "Load anyway". The precise depth/node/byte behavior is unit-tested against `buildTree` /
// `detectDocument` with small custom limits; the end-to-end `limited` flag + override is tested through
// `runPipeline` against the real (large) default caps with a genuinely deep document.

const onlyDepth = (maxDepth: number): Limits => ({ maxBytes: Infinity, maxDepth, maxNodes: Infinity });
const onlyNodes = (maxNodes: number): Limits => ({ maxBytes: Infinity, maxDepth: Infinity, maxNodes });
const onlyBytes = (maxBytes: number): Limits => ({ maxBytes, maxDepth: Infinity, maxNodes: Infinity });

/** An OpenAPI 3.1 document whose `components/schemas/A` nests `items` `depth` levels deep. */
function deeplyNestedOad(depth: number): string {
  let schema = '{"type":"object"}';
  for (let i = 0; i < depth; i++) schema = `{"type":"array","items":${schema}}`;
  return `{"openapi":"3.1.0","info":{"title":"T","version":"1"},"paths":{},"components":{"schemas":{"A":${schema}}}}`;
}

describe("formatBytes", () => {
  it("renders MB, KB, and B", () => {
    expect(formatBytes(8 * 1024 * 1024)).toBe("8 MB");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatBytes(512)).toBe("512 B");
  });
});

describe("buildTree resource guards", () => {
  it("refuses an over-deep tree with a located depth error", () => {
    let value: unknown = 0;
    for (let i = 0; i < 8; i++) value = [value]; // 8 nested arrays, cap is 5

    try {
      buildTree(value, onlyDepth(5));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResourceLimitError);
      expect((e as ResourceLimitError).kind).toBe("depth");
      expect((e as Error).message).toMatch(/nested too deeply/);
      // The message locates where it bottomed out (depth 6 = six array indices past the root).
      expect((e as Error).message).toContain("#/0/0/0/0/0/0");
    }
  });

  it("refuses a tree with too many nodes", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 20; i++) wide[`k${i}`] = i; // 1 root + 20 = 21 nodes, cap is 10

    try {
      buildTree(wide, onlyNodes(10));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ResourceLimitError);
      expect((e as ResourceLimitError).kind).toBe("nodes");
      expect((e as Error).message).toMatch(/too many nodes/);
    }
  });

  it("builds normally within the (default) limits", () => {
    const root = buildTree({ openapi: "3.1.0", info: {} });
    expect(root.children.length).toBe(2);
  });
});

describe("detectDocument byte cap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses an uploaded document larger than the byte cap", async () => {
    const big = `openapi: 3.1.0\n# ${"x".repeat(4000)}`;
    const promise = detectDocument(makeInput(big), false, onlyBytes(1000));
    await expect(promise).rejects.toBeInstanceOf(ResourceLimitError);
    await expect(promise).rejects.toMatchObject({ kind: "bytes" });
    await expect(promise).rejects.toThrow(/too large/);
  });

  it("refuses a fetched document by its advertised Content-Length, before reading the body", async () => {
    const text = vi.fn(async () => "openapi: 3.1.0\ninfo: {}\npaths: {}\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: (h: string) => (h === "content-length" ? "5000000" : null) },
        text,
      })),
    );
    const url: DocInput = { source: "url", url: "https://e.test/big.yaml", isEntry: true };
    await expect(detectDocument(url, false, onlyBytes(1000))).rejects.toBeInstanceOf(ResourceLimitError);
    expect(text).not.toHaveBeenCalled(); // rejected before the body is materialized
  });

  it("refuses a fetched document with no Content-Length once its body exceeds the cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        text: async () => "x".repeat(5000),
      })),
    );
    const url: DocInput = { source: "url", url: "https://e.test/big.yaml", isEntry: true };
    await expect(detectDocument(url, false, onlyBytes(1000))).rejects.toMatchObject({ kind: "bytes" });
  });
});

describe("runPipeline limit enforcement and 'Load anyway' override", () => {
  it("refuses an over-deep document under the default caps, flagging it as limited", async () => {
    const result = await runPipeline([makeInput(deeplyNestedOad(200), { isEntry: true })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.limited).toBe(true);
    expect(Object.values(result.rowErrors ?? {})[0]).toMatch(/nested too deeply/);
  });

  it("loads the same document when limits are lifted (enforceLimits: false)", async () => {
    const result = await runPipeline(
      [makeInput(deeplyNestedOad(200), { isEntry: true })],
      undefined,
      { enforceLimits: false },
    );
    expect(result.ok).toBe(true);
  });

  it("does not flag a normal document as limited", async () => {
    const ok = `openapi: 3.1.0\ninfo: { title: T, version: '1' }\npaths: {}\n`;
    const result = await runPipeline([makeInput(ok, { isEntry: true })]);
    expect(result.ok).toBe(true);
  });
});
