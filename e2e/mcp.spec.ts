import { test, expect, type Page } from "@playwright/test";

test.describe("MCP demo page", () => {
  test("Try it over MCP carries the current view over and shows a real wire log", async ({
    page,
  }) => {
    await page.goto("view?demo=refs");
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
    await page.goto("mcp?demo=refs");
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

  // The elicitation round trip is the demo's whole reason for shipping a scenario: no bundled demo
  // can reach it, because a demo's own config always wins over the caller's.
  test("a scenario drives a real elicitation round trip, both halves visible in the wire log", async ({
    page,
  }) => {
    await page.goto("mcp");
    await page.getByRole("button", { name: "A document fragment" }).click();
    await expect(page.getByText(/Analyzing scenario/)).toBeVisible();

    await page.getByRole("button", { name: /^Call / }).click();

    const panel = page.locator(".elicit-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("document fragments");
    await panel.locator("select").first().selectOption("root");
    await panel.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByRole("heading", { name: "Result" })).toBeVisible({ timeout: 15_000 });

    // The server asked, then the client answered on a retry: both halves are on the wire.
    const wire = await page.evaluate(() => document.body.textContent ?? "");
    expect(wire).toContain("input_required");
    expect(wire).toContain("inputResponses");
  });

  test("Try it over MCP from the configure page analyzes the entered document", async ({
    page,
  }) => {
    await page.goto("configure");
    // Base-safe: derive the fixture URL from the current page's own origin+base rather than
    // hardcoding "/fixtures/...", which would escape a sub-path deploy base and 404.
    const fixtureUrl = new URL("fixtures/petstore-3.1.yaml", page.url()).pathname;
    await page.locator(".doc-row").first().locator("input.url").fill(fixtureUrl);
    await page.getByRole("button", { name: "Try it over MCP" }).click();

    // Url-only inputs stay bookmarkable, same as a direct /view?doc= load.
    await expect(page).toHaveURL(/\/mcp\?doc=/);
    await expect(page.getByText(/Analyzing: petstore-3\.1\.yaml/)).toBeVisible();
    await expect(page.locator(".wire-exchange").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Render OAD from the MCP page opens the same source in the explorer", async ({ page }) => {
    await page.goto("mcp?demo=refs");
    await expect(page.getByText(/Analyzing demo/)).toBeVisible();

    await page.getByRole("button", { name: "Render OAD" }).click();
    await expect(page).toHaveURL(/\/view\?demo=refs/);
    await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();
  });

  test("code-split guard: /configure never requests the MCP chunk, /mcp does", async ({ page }) => {
    // Match on response *content*, not the request URL: the dev server serves unbundled source
    // (URLs literally contain "mcp/hosts/browser" and "@modelcontextprotocol"), but a production
    // build folds that module into a content-hashed chunk name that carries none of those
    // substrings — only the bundled code itself still does.
    const isMcpModule = (body: string) => /modelcontextprotocol/i.test(body);
    const scriptBodies = (p: Page): Promise<string>[] => {
      const bodies: Promise<string>[] = [];
      p.on("response", (res) => {
        if (res.request().resourceType() === "script") bodies.push(res.text().catch(() => ""));
      });
      return bodies;
    };

    const configureBodies = scriptBodies(page);
    await page.goto("configure");
    await expect(page.locator(".oad-form")).toBeVisible();
    expect((await Promise.all(configureBodies)).some(isMcpModule)).toBe(false);

    page.removeAllListeners("response");
    const mcpBodies = scriptBodies(page);
    await page.goto("mcp?demo=refs");
    await expect(page.locator(".wire-exchange").first()).toBeVisible({ timeout: 10_000 });
    expect((await Promise.all(mcpBodies)).some(isMcpModule)).toBe(true);
  });
});
