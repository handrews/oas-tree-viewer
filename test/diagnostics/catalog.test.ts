import { describe, it, expect } from "vitest";
import { DIAGNOSTIC_CODES } from "../../src/diagnostics/types";
import { diagnosticCatalog, emittedSeverity, severityFor } from "../../src/diagnostics/catalog";

const VALID_SEVERITIES = new Set(["error", "warning", "info", "off"]);

describe("diagnostic catalog", () => {
  it("covers exactly the DIAGNOSTIC_CODES set (none missing, no orphans)", () => {
    expect(Object.keys(diagnosticCatalog()).sort()).toEqual([...DIAGNOSTIC_CODES].sort());
  });

  it("every entry has a valid severity and non-empty title + description", () => {
    for (const [code, entry] of Object.entries(diagnosticCatalog())) {
      expect(VALID_SEVERITIES.has(entry.severity), `${code} severity`).toBe(true);
      expect(entry.title.trim(), `${code} title`).not.toBe("");
      expect(entry.description.trim(), `${code} description`).not.toBe("");
    }
  });

  it("severityFor reads the catalog policy", () => {
    expect(severityFor("ref-broken")).toBe("error");
    expect(severityFor("ref-external")).toBe("warning");
    expect(severityFor("operation-target-fragile")).toBe("warning");
  });

  it("emittedSeverity resolves a policy to a severity, or null when off", () => {
    expect(emittedSeverity("error")).toBe("error");
    expect(emittedSeverity("warning")).toBe("warning");
    expect(emittedSeverity("info")).toBe("info");
    expect(emittedSeverity("off")).toBeNull();
  });
});
