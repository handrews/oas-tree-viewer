import { test, expect } from "@playwright/test";
import type { AxeResults, Result } from "axe-core";
import AxeBuilder from "@axe-core/playwright";
import { renderUploads } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Rules still analyzed and reported below, but not yet gating. color-contrast is a
// function of the current (placeholder) palette; Phase 2 redefines both palettes and
// re-enables this rule as the gate in light AND dark mode.
// TODO(phase2): remove color-contrast from DEFERRED and assert across both themes.
const DEFERRED = new Set(["color-contrast"]);
const gating = (v: Result): boolean =>
  (v.impact === "serious" || v.impact === "critical") && !DEFERRED.has(v.id);

function summarize(results: AxeResults): string {
  if (results.violations.length === 0) return "no violations";
  return results.violations
    .map((v) => {
      const targets = v.nodes.map((n) => `      ${n.target.join(" ")}`).join("\n");
      return `  • [${v.impact}] ${v.id}: ${v.help}\n${targets}`;
    })
    .join("\n");
}

test.describe("accessibility (axe-core, WCAG 2.1 A/AA)", () => {
  test("input form view", async ({ page }, testInfo) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    testInfo.attach("axe-form-violations", { body: summarize(results), contentType: "text/plain" });
    console.log(`[axe] form view — ${results.violations.length} violation type(s):\n${summarize(results)}`);
    expect(results.violations.filter(gating), summarize(results)).toEqual([]);
  });

  test("rendered OAD view", async ({ page }, testInfo) => {
    await renderUploads(page, ["refs-3.1.yaml", "refs-shared-3.1.yaml"]);
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    testInfo.attach("axe-rendered-violations", { body: summarize(results), contentType: "text/plain" });
    console.log(`[axe] rendered view — ${results.violations.length} violation type(s):\n${summarize(results)}`);
    expect(results.violations.filter(gating), summarize(results)).toEqual([]);
  });
});
