import { test, expect, type Page } from "@playwright/test";
import type { AxeResults, Result } from "axe-core";
import AxeBuilder from "@axe-core/playwright";
import { fixture, renderUploads } from "./helpers";

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

    test("input form — busy render with Cancel", async ({ page }) => {
      // The Cancel button only exists while a render is in flight. Stub Worker so the pipeline
      // never answers, holding the busy state (disabled submits + Cancel) for the axe run.
      await page.addInitScript(() => {
        window.Worker = class {
          postMessage(): void {}
          addEventListener(): void {}
          terminate(): void {}
        } as unknown as typeof Worker;
      });
      await page.goto("/");
      await page.locator(".doc-row input.file").setInputFiles(fixture("refs-3.1.yaml"));
      await page.getByRole("button", { name: "Render OAD" }).click();
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("input form — resource-guard refusal with Load anyway", async ({ page }) => {
      // A document nested past the depth cap is refused with the "Load anyway" override shown.
      await page.goto("/");
      const deep =
        '{"openapi":"3.1.0","info":{"title":"deep","version":"1"},"paths":{},"x-deep":' +
        '{"a":'.repeat(200) +
        "1" +
        "}".repeat(200) +
        "}";
      await page.locator(".doc-row input.file").setInputFiles({
        name: "deep.json",
        mimeType: "application/json",
        buffer: Buffer.from(deep),
      });
      await page.getByRole("button", { name: "Render OAD" }).click();
      await expect(page.getByRole("button", { name: "Load anyway" })).toBeVisible();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("view page — loading with Cancel", async ({ page }) => {
      // Same Worker stub: the view page's load never settles, holding the "Loading documents…"
      // state with its own Cancel button for the axe run.
      await page.addInitScript(() => {
        window.Worker = class {
          postMessage(): void {}
          addEventListener(): void {}
          terminate(): void {}
        } as unknown as typeof Worker;
      });
      await page.goto("/view?demo=refs");
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
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

    test("$recursiveRef links view", async ({ page }) => {
      // The 2019-09 recursive fan-out reuses the dotted "tentative" arcs; check them against contrast.
      await page.goto("/view?demo=recursiveref");
      await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
      await page.getByRole("button", { name: "Show all references" }).click();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("draft-04/06/07 references view", async ({ page }) => {
      // Exercises the broadened dialect ⚠ glyph (numbered-draft advisories) and the new issue-drawer
      // category against the contrast gate.
      await page.goto("/view?demo=numbered-drafts");
      await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
      await page.getByRole("button", { name: "Show all references" }).click();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("standalone JSON Schema view", async ({ page }) => {
      // A Schema-Object-root document with its dialect header and resolved internal arcs.
      await page.goto("/view?demo=jsonschema");
      await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
      await page.getByRole("button", { name: "Show all references" }).click();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("document fragment view", async ({ page }) => {
      // A fragment typed from a root reference, with its "Fragment · …" header and resolved arcs.
      await page.goto("/view?demo=fragment&fragments=root");
      await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
      await page.getByRole("button", { name: "Show all references" }).click();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("interior-references fragment view", async ({ page }) => {
      // A library fragment typed only at interior nodes ("partially typed" header).
      await page.goto("/view?demo=fragment-interior&fragments=any");
      await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
      await page.getByRole("button", { name: "Show all references" }).click();
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("MCP demo page (idle)", async ({ page }) => {
      await page.goto("/mcp?demo=refs");
      await expect(page.locator(".wire-group").first()).toBeVisible({ timeout: 10_000 });
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    test("MCP demo page (with a result shown)", async ({ page }) => {
      await page.goto("/mcp?demo=refs");
      await expect(page.locator(".wire-group").first()).toBeVisible({ timeout: 10_000 });
      await page.getByRole("button", { name: /^Call / }).click();
      await expect(page.locator(".mcp-result-text")).toContainText("issue report", {
        timeout: 10_000,
      });
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });

    // The rendered CHANGELOG page shares the app's palette (see vite/doc-pages.ts) and must
    // clear the same contrast gate — headings, links, and code on the theme bg.
    test("changelog page", async ({ page }) => {
      await page.goto("/changelog.html");
      await setTheme(page, theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
    });
  });
}

// `heading-order` is an axe best-practice rule (outside the WCAG tags above) and is what Lighthouse
// flags. Each Explore-page panel (legend, detail, issues) is a section: an h2 title with h3
// subsections, so the document headings descend without skipping a level. Exercise all three at once.
test.describe("heading order (no skipped levels — for a perfect Lighthouse score)", () => {
  test("the Explore page headings descend sequentially with every panel open", async ({ page }) => {
    await page.goto("/view?demo=refs"); // the refs demo has issues, so the issue drawer opens
    await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
    await page.locator("svg.tree-canvas g.row").first().click(); // select a node → detail headings
    await expect(page.locator("#detail-panel .node-detail")).toContainText("Node details");
    const results = await new AxeBuilder({ page }).withRules(["heading-order"]).analyze();
    expect(results.violations, summarize(results)).toEqual([]);
  });
});

// The SVG tree is a WAI-ARIA Tree View: keyboard-operable, with valid tree/treeitem roles. This is the
// deferred SVG-native accessibility work — exercise the real keyboard path and a clean axe run.
test.describe("SVG tree — keyboard navigation & ARIA", () => {
  test("is keyboard operable with valid tree roles and a visible focus ring", async ({ page }) => {
    await page.goto("/view?demo=refs");
    const items = page.locator('g.row[role="treeitem"]');
    await expect(items.first()).toBeVisible();

    // Tree + treeitem ARIA.
    const tree = page.locator('[role="tree"]').first();
    await expect(tree).toHaveAttribute("aria-label", /OAS 3\.1/);
    await expect(tree).toHaveAttribute("aria-describedby", "tree-help");
    await expect(items.first()).toHaveAttribute("aria-level", "1");
    await expect(items.first()).toHaveAttribute("aria-expanded", "true");

    // Focus the root: it takes DOM focus and shows the keyboard focus ring (a 2px stroked row-bg).
    await items.first().focus();
    await expect(items.first()).toBeFocused();
    await expect(items.first().locator(".row-bg")).toHaveCSS("stroke-width", "2px");

    // Down moves focus to the next visible row.
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();

    // Right expands a collapsed branch in place (more rows; the focused row becomes expanded).
    const before = await items.count();
    await page.locator('g.row[role="treeitem"][aria-expanded="false"]').first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('g.row[role="treeitem"]')).not.toHaveCount(before);
    await expect(page.locator(":focus")).toHaveAttribute("aria-expanded", "true");

    // Enter selects the focused node (explicit selection) → the detail panel updates.
    await page.keyboard.press("Enter");
    await expect(page.locator("#detail-panel .node-detail")).toContainText("Node details");
    await expect(page.locator(':focus[aria-selected="true"]')).toBeVisible();

    // The new tree/treeitem roles are valid ARIA (no serious/critical violations).
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.filter(blocking), summarize(results)).toEqual([]);
  });
});
