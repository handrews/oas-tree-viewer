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

    // The same problems are written out in the copy-pasteable issue drawer.
    const issues = page.locator("#issues");
    await expect(issues).toBeVisible();
    await expect(issues).toContainText("Unresolved references");
    await expect(issues.locator(".copy-report")).toBeVisible();
    await expect(issues.locator(".issue").first()).toBeVisible();
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

test.describe("demos, online URLs & bookmarking", () => {
  test("/ redirects to /configure and shows the form", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/configure$/);
    await expect(page.locator(".oad-form")).toBeVisible();
  });

  test("a demo loads, is bookmarkable, and Back returns to configure", async ({ page }) => {
    await page.goto("/configure");
    await page.getByRole("button", { name: "Broken & external references (3.1)" }).click();

    await expect(page).toHaveURL(/\/view\?demo=refs/);
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(2);
    const issues = page.locator("#issues");
    await expect(issues).toBeVisible();
    await expect(issues).toContainText("Unresolved references");
    await expect(issues.locator(".copy-report")).toBeVisible();

    // Reloading the bookmarked URL reproduces the same view (SPA fallback serves index.html).
    await page.reload();
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(2);

    // Back returns to the configure page.
    await page.goBack();
    await expect(page).toHaveURL(/\/configure/);
    await expect(page.locator(".oad-form")).toBeVisible();
  });

  test("the view page has a button to load a different OAD", async ({ page }) => {
    await page.goto("/view?demo=refs");
    await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();

    await page.getByRole("button", { name: "Load a different OAD" }).click();
    await expect(page).toHaveURL(/\/configure/);
    await expect(page.locator(".oad-form")).toBeVisible();
  });

  test("the $self demo resolves cleanly (no issues)", async ({ page }) => {
    await page.goto("/configure");
    await page.getByRole("button", { name: "Multi-document $self (3.2)" }).click();

    await expect(page).toHaveURL(/\/view\?demo=self/);
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(4);
    await expect(page.locator("#issues .issue")).toHaveCount(0);
  });

  test("an online document URL loads directly and is bookmarkable", async ({ page }) => {
    await page.goto("/view?doc=" + encodeURIComponent("/fixtures/petstore-3.1.yaml"));
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(1);
  });

  test("a reloaded upload view shows the empty state", async ({ page }) => {
    await page.goto("/configure");
    await page.locator(".doc-row").first().locator("input.file").setInputFiles(fixture("petstore-3.1.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(1);

    // The upload handoff lives only in memory; a full reload drops it -> empty state.
    await page.reload();
    await expect(page.locator(".view-empty")).toBeVisible();
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page).toHaveURL(/\/configure/);
  });
});
