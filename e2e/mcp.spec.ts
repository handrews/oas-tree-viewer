import { test, expect } from "@playwright/test";

test.describe("MCP demo page", () => {
  test("Try it over MCP carries the current view over and shows a real wire log", async ({
    page,
  }) => {
    await page.goto("/view?demo=refs");
    await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();

    await page.getByRole("button", { name: "Try it over MCP" }).click();
    await expect(page).toHaveURL(/\/mcp\?demo=refs/);
    await expect(page.getByText(/Analyzing demo/)).toBeVisible();

    // Capabilities and the wire log come from a real handshake over the real handler.
    await expect(page.locator(".wire-exchange").first()).toBeVisible({ timeout: 10_000 });
    const headers = page.locator(".wire-headers").first();
    await expect(headers).toContainText("mcp-protocol-version");
    await expect(headers).toContainText("2026-07-28");

    // Call analyze-document with the schema-generated form's defaults; the demo's own diagnostics come
    // back as the issue report text plus resource_link chips.
    await page.getByRole("button", { name: /^Call / }).click();
    await expect(page.locator(".mcp-result-text")).toContainText("issue report", {
      timeout: 10_000,
    });

    // A resource_link chip issues a real resources/read — one more logged exchange.
    const before = await page.locator(".wire-exchange").count();
    await page.getByRole("button", { name: /Reference type mismatch/ }).click();
    await expect(page.locator(".wire-exchange")).toHaveCount(before + 1, { timeout: 10_000 });
  });

  test("explain-diagnostic answers plain JSON, in contrast to analyze-document's SSE stream", async ({
    page,
  }) => {
    await page.goto("/mcp?demo=refs");
    await expect(page.locator(".wire-exchange").first()).toBeVisible({ timeout: 10_000 });

    await page
      .locator(".mcp-tool-picker select")
      .selectOption({ label: "Explain a diagnostic code" });
    await page.getByRole("button", { name: /^Call / }).click();

    await expect
      .poll(async () => (await page.locator(".wire-exchange").allTextContents()).join("\n"), {
        timeout: 10_000,
      })
      .toContain("application/json");
  });

  test("code-split guard: /configure never requests the MCP chunk, /mcp does", async ({ page }) => {
    const isMcpChunk = (url: string) => /mcp[/-]hosts[/-]browser|modelcontextprotocol/i.test(url);

    const configureRequests: string[] = [];
    page.on("request", (req) => configureRequests.push(req.url()));
    await page.goto("/configure");
    await expect(page.locator(".oad-form")).toBeVisible();
    expect(configureRequests.some(isMcpChunk)).toBe(false);

    page.removeAllListeners("request");
    const mcpRequests: string[] = [];
    page.on("request", (req) => mcpRequests.push(req.url()));
    await page.goto("/mcp?demo=refs");
    await expect(page.locator(".wire-exchange").first()).toBeVisible({ timeout: 10_000 });
    expect(mcpRequests.some(isMcpChunk)).toBe(true);
  });
});
