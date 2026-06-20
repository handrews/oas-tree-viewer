import { describe, it, expect } from "vitest";
import { defaultConfig, parseConfig, configParams } from "../../src/app/config";

describe("config", () => {
  it("defaults to name-first / entry", () => {
    expect(defaultConfig).toEqual({ mappingPrecedence: "name-first", componentLookup: "entry" });
  });

  it("parses non-default values and falls back to defaults otherwise", () => {
    expect(parseConfig(new URLSearchParams(""))).toEqual(defaultConfig);
    expect(parseConfig(new URLSearchParams("disc=uri-first&lookup=local"))).toEqual({
      mappingPrecedence: "uri-first",
      componentLookup: "local",
    });
    // Unrecognized values fall back to defaults (no throwing).
    expect(parseConfig(new URLSearchParams("disc=bogus&lookup=bogus"))).toEqual(defaultConfig);
  });

  it("emits only non-default params (default config -> empty)", () => {
    expect(configParams(defaultConfig).toString()).toBe("");
    expect(configParams({ mappingPrecedence: "uri-first", componentLookup: "entry" }).toString()).toBe(
      "disc=uri-first",
    );
    expect(configParams({ mappingPrecedence: "name-first", componentLookup: "local" }).toString()).toBe(
      "lookup=local",
    );
  });

  it("round-trips through configParams -> parseConfig", () => {
    for (const cfg of [
      defaultConfig,
      { mappingPrecedence: "uri-first", componentLookup: "local" } as const,
      { mappingPrecedence: "uri-first", componentLookup: "entry" } as const,
      { mappingPrecedence: "name-first", componentLookup: "local" } as const,
    ]) {
      expect(parseConfig(new URLSearchParams(configParams(cfg).toString()))).toEqual(cfg);
    }
  });
});
