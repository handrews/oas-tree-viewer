import { test, expect } from "@playwright/test";
import { fixture, renderUploads } from "./helpers";

test.describe("rendering an OAD", () => {
  test("renders one tree per uploaded document, entry first", async ({ page }) => {
    await renderUploads(page, ["petstore-3.1.yaml", "shared-3.1.yaml"]);

    const docs = page.locator("svg.tree-canvas g.doc");
    await expect(docs).toHaveCount(2);
    // The entry document carries the ENTRY badge.
    await expect(page.locator(".entry-badge")).toHaveCount(1);
    // The detail panel shows the legend once a render has happened.
    await expect(page.locator("#detail-panel")).toContainText("Legend");
  });

  test("expand all / collapse all change the visible row count", async ({ page }) => {
    await renderUploads(page, ["petstore-3.1.yaml"]);
    const rows = page.locator("svg.tree-canvas g.row");

    await page.getByRole("button", { name: "Expand all" }).click();
    const expanded = await rows.count();
    await page.getByRole("button", { name: "Collapse all" }).click();
    const collapsed = await rows.count();

    expect(expanded).toBeGreaterThan(collapsed);
  });

  test("selecting a node populates the detail panel", async ({ page }) => {
    await renderUploads(page, ["petstore-3.1.yaml"]);

    await page.locator("svg.tree-canvas g.row").first().click();
    const detail = page.locator("#detail-panel .node-detail");
    await expect(detail).toContainText("Selected node");
    await expect(detail).toContainText("Pointer");
  });
});

test.describe("references", () => {
  test("show-all draws reference arcs and warning glyphs", async ({ page }) => {
    await renderUploads(page, ["refs-3.1.yaml", "refs-shared-3.1.yaml"]);

    await page.getByRole("button", { name: "Show all references" }).click();

    // Resolvable references become arcs; broken/external ones show a ⚠ glyph.
    await expect(page.locator("svg.tree-canvas .arcs path.ref-edge").first()).toBeVisible();
    await expect(page.locator("svg.tree-canvas .warnings text.warn-glyph").first()).toBeVisible();
  });
});

test.describe("error handling", () => {
  test("a non-OpenAPI document is reported on its row", async ({ page }) => {
    await page.goto("/");
    await page.locator(".doc-row").first().locator("input.file").setInputFiles(fixture("not-openapi.json"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".row-error")).toContainText("not an OpenAPI document");
    await expect(page.locator("#viewer")).toBeHidden();
  });

  test("an unparseable document is reported on its row", async ({ page }) => {
    await page.goto("/");
    await page.locator(".doc-row").first().locator("input.file").setInputFiles(fixture("invalid.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".row-error")).toContainText(/Invalid YAML|Could not parse/i);
  });

  test("mixing OAS 3.1 and 3.2 is reported above the form", async ({ page }) => {
    await page.goto("/");
    await page.locator(".doc-row").first().locator("input.file").setInputFiles(fixture("petstore-3.1.yaml"));
    await page.getByRole("button", { name: "+ Add document" }).click();
    await page.locator(".doc-row").nth(1).locator("input.file").setInputFiles(fixture("tictactoe-3.2.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".oad-error")).toContainText(/mixes OAS 3.1 and 3.2/i);
  });
});
