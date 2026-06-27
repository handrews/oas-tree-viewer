// Malicious / hostile-input tests. The viewer ingests untrusted documents (uploads, pasted text, fetched
// URLs), so these assert the *processing* path is safe: no document can get arbitrary JavaScript to run,
// pollute Object.prototype, or hang/crash the pipeline. They drive the real parse + load path, not mocks.
//
// All assertions are about *input-independent* safety invariants — never about a parsed value's shape — so
// they don't go stale as parsing evolves. The fuzz sweep is deterministic (fixed-seed PRNG) so any failure
// reproduces from the committed seed; "doesn't hang" is enforced by the vitest per-test timeout, never a
// machine-dependent wall-clock assertion.

import { afterEach, describe, expect, test } from "vitest";
import { parseDocument } from "../src/parse/detectFormat";
import { loadDocument } from "../src/loader";
import { OadError, ParseError, ResourceLimitError } from "../src/errors";
import { makeInput } from "./helpers";

// A canary on Object.prototype: if any input pollutes the global prototype, a *fresh* empty object inherits
// the key. Checked after each test; nothing here should ever set it.
const POLLUTION_KEYS = ["polluted", "__sec_pwned", "isAdmin"] as const;
function assertNoPrototypePollution(): void {
  for (const k of POLLUTION_KEYS) {
    expect(Object.prototype as Record<string, unknown>).not.toHaveProperty(k);
    expect(({} as Record<string, unknown>)[k]).toBeUndefined(); // a fresh object inherits nothing
  }
}

afterEach(() => {
  // Defensive cleanup so one leaked key can't cascade into every later test.
  for (const k of POLLUTION_KEYS) delete (Object.prototype as Record<string, unknown>)[k];
  delete (globalThis as Record<string, unknown>).__sec_pwned;
});

describe("no arbitrary code execution from document tags", () => {
  // eemeli/yaml's default schema has no code-constructing tags (unlike js-yaml's unsafe schema). A document
  // that *tries* to run code via a tag must either parse to inert data or be rejected — never execute.
  const HOSTILE_TAGS = [
    // js-yaml-style function tag; the payload would flip the probe IF anything ran it.
    `value: !!js/function "function (){ globalThis.__sec_pwned = 'YES'; }()"`,
    // python/object construction (PyYAML-style).
    `value: !!python/object/apply:os.system ["echo pwned"]`,
    // an arbitrary custom tag.
    `value: !<tag:evil.example,2026:exec> "globalThis.__sec_pwned = 'YES'"`,
  ];

  test.each(HOSTILE_TAGS)("a hostile YAML tag never runs code: %s", (doc) => {
    // Parsing either throws a clean ParseError or yields inert data; in neither case does the probe flip.
    try {
      parseDocument(doc, "evil.yaml");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
    }
    expect((globalThis as Record<string, unknown>).__sec_pwned).toBeUndefined();
  });
});

describe("no prototype pollution from document keys", () => {
  test.each([
    ["JSON __proto__", '{"__proto__": {"polluted": "yes"}}', "p.json"],
    ["JSON constructor.prototype", '{"constructor": {"prototype": {"polluted": "yes"}}}', "p.json"],
    ["YAML __proto__", "__proto__:\n  polluted: yes\n", "p.yaml"],
    ["YAML constructor", "constructor:\n  prototype:\n    polluted: yes\n", "p.yaml"],
  ])("parsing a doc with %s does not pollute Object.prototype", (_name, text, filename) => {
    parseDocument(text, filename);
    assertNoPrototypePollution();
  });

  test("dangerous keys inside a valid OAS document load as ordinary nodes, no pollution", async () => {
    const oad = `
openapi: 3.1.0
info: { title: T, version: '1' }
paths: {}
components:
  schemas:
    Evil:
      type: object
      properties:
        __proto__: { type: string }
        constructor: { type: string }
        prototype: { type: string }
`;
    const doc = await loadDocument(makeInput(oad, { filename: "evil.yaml", isEntry: true }));
    // The keys became real tree nodes (not silently dropped, not assigned onto a prototype).
    const props = doc.root; // walk for the properties' keys
    const keys = new Set<string>();
    const walk = (n: { key?: string; children: unknown[] }): void => {
      if (n.key) keys.add(n.key);
      for (const c of n.children) walk(c as typeof n);
    };
    walk(props as unknown as { key?: string; children: unknown[] });
    expect(keys.has("__proto__")).toBe(true);
    expect(keys.has("constructor")).toBe(true);
    assertNoPrototypePollution();
  });
});

describe("resource-exhaustion inputs are bounded, not hung", () => {
  test("a YAML alias bomb (billion laughs) is rejected, not expanded", () => {
    // Classic exponential anchor/alias expansion. eemeli/yaml caps alias resolution, so this throws a clean
    // ParseError rather than materializing a huge structure. (Termination is guaranteed by the cap + the
    // vitest timeout, so no wall-clock assertion is needed.)
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "e: &e [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]",
      "f: &f [*e, *e, *e, *e, *e, *e, *e, *e, *e, *e]",
      "g: [*f, *f, *f, *f, *f, *f, *f, *f, *f, *f]",
    ].join("\n");
    expect(() => parseDocument(bomb, "bomb.yaml")).toThrow(ParseError);
  });

  test("a document nested past the depth cap is refused with a ResourceLimitError", async () => {
    // ~300 levels of nesting — well past MAX_TREE_DEPTH (128), the crash guard that keeps every later stage
    // (incl. Hyperjump validation) from overflowing the stack. The deep structure sits inside a valid
    // OpenAPI envelope so detection accepts the document and the tree builder reaches the deep payload.
    const depth = 300;
    const deep = "[".repeat(depth) + "]".repeat(depth);
    const text = `{"openapi":"3.1.0","info":{"title":"T","version":"1"},"paths":{},"x-deep":${deep}}`;
    const input = (): ReturnType<typeof makeInput> =>
      makeInput(text, { filename: "deep.json", isEntry: true });
    await expect(loadDocument(input())).rejects.toMatchObject({
      name: "ResourceLimitError",
      kind: "depth",
    });
    await expect(loadDocument(input())).rejects.toBeInstanceOf(ResourceLimitError);
  });
});

describe("fuzz sweep: random hostile input never throws unexpectedly, hangs, or pollutes", () => {
  // Deterministic PRNG (mulberry32) — a fixed seed makes the corpus stable, so any failure reproduces.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fragments chosen to poke the dangerous corners: tags, anchors/aliases, prototype keys, control chars,
  // unbalanced structure, and OpenAPI-ish bait that may pass detection and reach later stages.
  const PALETTE = [
    "{",
    "}",
    "[",
    "]",
    ":",
    "- ",
    "&a ",
    "*a ",
    "!!js/function ",
    "!<x> ",
    "__proto__:",
    "constructor:",
    "prototype:",
    '"',
    "'",
    "\n",
    "  ",
    "\t",
    "\u0000",
    "",
    "\uffff",
    "openapi: 3.1.0\n",
    "$ref: ",
    "#/x/y",
    "%",
    "@",
    "0",
    "true",
    "null",
    "key",
    "value",
    "info:",
    "paths:",
  ];

  function randomDoc(rand: () => number): string {
    const tokens = 1 + Math.floor(rand() * 60); // bounded length
    let s = "";
    for (let i = 0; i < tokens; i++) s += PALETTE[Math.floor(rand() * PALETTE.length)];
    return s.slice(0, 2048); // hard length cap, defensive
  }

  test("200 seeded random documents are always handled safely", async () => {
    const rand = mulberry32(0x5eed_1234);
    for (let i = 0; i < 200; i++) {
      const text = randomDoc(rand);
      const filename = ["a.yaml", "a.json", "a.yml", "a"][Math.floor(rand() * 4)]!;

      // parseDocument: returns a ParsedDoc or throws ONLY ParseError.
      let parsed = false;
      try {
        parseDocument(text, filename);
        parsed = true;
      } catch (e) {
        expect(
          e,
          `parse threw non-ParseError for input #${i}: ${JSON.stringify(text)}`,
        ).toBeInstanceOf(ParseError);
      }

      // loadDocument: resolves or rejects ONLY with an OadError subclass — never an unexpected throw.
      if (parsed) {
        try {
          await loadDocument(makeInput(text, { filename, isEntry: true }));
        } catch (e) {
          expect(
            e,
            `load threw non-OadError for input #${i}: ${JSON.stringify(text)}`,
          ).toBeInstanceOf(OadError);
        }
      }
    }
    assertNoPrototypePollution();
  }, 20_000); // generous timeout: a true hang fails here; a slow-but-finite run still passes
});
