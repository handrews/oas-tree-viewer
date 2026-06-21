import { test, expect, type Page } from "@playwright/test";
import type { AxeResults, Result } from "axe-core";
import AxeBuilder from "@axe-core/playwright";
import { renderUploads } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const blocking = (v: Result): boolean => v.impact === "serious" || v.impact === "critical";

function summarize(results: AxeResults): string {
  if (results.violations.length === 0) return "no violations";
  return results.violations
    .map((v) => {
      const targets = v.nodes.map((n) => `      ${n.target.join(" ")}`).join("\n");
      return `  • [${v.impact}] ${v.id}: ${v.help}\n${targets}`;
    })
    .join("\n");
}

async function setTheme(page: Page, theme: "dark" | "light"): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

// Both palettes must pass WCAG 2.1 A/AA — including color-contrast, which is the
// acceptance gate for the theming work.
for (const theme of ["dark", "light"] as const) {
  test.describe(`accessibility — ${theme} theme (axe-core, WCAG 2.1 A/AA)`, () => {
    test("input form view", async ({ page }) => {
      await page.goto("/");
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("rendered OAD view", async ({ page }) => {
      await renderUploads(page, ["refs-3.1.yaml", "refs-shared-3.1.yaml"]);
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("operation-reference advisories view", async ({ page }) => {
      // Exercises the new advisory legend section + glyph/arc colors against the contrast gate.
      await page.goto("/view?demo=operation-refs");
      await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
      await page.getByRole("button", { name: "Show all references" }).click();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("operationId links view", async ({ page }) => {
      // Exercises the implicit-connection legend row (relabeled for operationId), the double-line
      // operationId arcs, a broken-operationId glyph, and the unreachable-document badge.
      await page.goto("/view?demo=operationid");
      await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
      await page.getByRole("button", { name: "Show all references" }).click();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("$dynamicRef links view", async ({ page }) => {
      // Exercises the new dotted "tentative" legend row + the dotted $dynamicRef arcs against the
      // contrast gate, plus a broken glyph and the unreachable-document badge.
      await page.goto("/view?demo=dynamicref");
      await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
      await page.getByRole("button", { name: "Show all references" }).click();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });
  });
}
