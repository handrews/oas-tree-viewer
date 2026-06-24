import { describe, it, expect } from "vitest";
import { defaultConfig, parseConfig, configParams } from "../../src/app/config";

describe("config", () => {
  it("defaults to name-first / entry / fragments none", () => {
    expect(defaultConfig).toEqual({
      mappingPrecedence: "name-first",
      componentLookup: "entry",
      fragments: "none",
    });
  });

  it("parses non-default values and falls back to defaults otherwise", () => {
    expect(parseConfig(new URLSearchParams(""))).toEqual(defaultConfig);
    expect(parseConfig(new URLSearchParams("disc=uri-first&lookup=local&fragments=any"))).toEqual({
      mappingPrecedence: "uri-first",
      componentLookup: "local",
      fragments: "any",
    });
    expect(parseConfig(new URLSearchParams("fragments=root")).fragments).toBe("root");
    // Unrecognized values fall back to defaults (no throwing).
    expect(parseConfig(new URLSearchParams("disc=bogus&lookup=bogus&fragments=bogus"))).toEqual(
      defaultConfig,
    );
  });

  it("emits only non-default params (default config -> empty)", () => {
    expect(configParams(defaultConfig).toString()).toBe("");
    expect(configParams({ ...defaultConfig, mappingPrecedence: "uri-first" }).toString()).toBe(
      "disc=uri-first",
    );
    expect(configParams({ ...defaultConfig, componentLookup: "local" }).toString()).toBe(
      "lookup=local",
    );
    expect(configParams({ ...defaultConfig, fragments: "root" }).toString()).toBe("fragments=root");
    expect(configParams({ ...defaultConfig, fragments: "any" }).toString()).toBe("fragments=any");
  });

  it("round-trips through configParams -> parseConfig", () => {
    for (const cfg of [
      defaultConfig,
      { mappingPrecedence: "uri-first", componentLookup: "local", fragments: "any" } as const,
      { mappingPrecedence: "uri-first", componentLookup: "entry", fragments: "none" } as const,
      { mappingPrecedence: "name-first", componentLookup: "local", fragments: "root" } as const,
    ]) {
      expect(parseConfig(new URLSearchParams(configParams(cfg).toString()))).toEqual(cfg);
    }
  });
});
