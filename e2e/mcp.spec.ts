import { test, expect, type Page } from "@playwright/test";

test.describe("MCP demo page", () => {
  test("Try it over MCP carries the current view over and shows a real wire log", async ({
    page,
  }) => {
    await page.goto("view?demo=refs");
    await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();

    await page.getByRole("button", { name: "Try it over MCP" }).click();
    await expect(page).toHaveURL(/\/mcp\?demo=refs/);
    await expect(page.getByText(/MCP interface for demo/)).toBeVisible();

    // Capabilities and the wire log come from a real handshake over the real handler, grouped under
    // the connect/discovery action and collapsed by default.
    const discoveryGroup = page.locator(".wire-group").first();
    await expect(discoveryGroup).toBeVisible({ timeout: 10_000 });
    await expect(discoveryGroup.locator("> details")).not.toHaveAttribute("open");
    // A plain `.click()` targets the summary's bounding-box center, which — in this narrow sidebar
    // column — lands on the embedded "capabilities" link-span (see McpPage.svelte's openCapabilities),
    // opening the capabilities panel instead of toggling this group. Click near the left edge instead,
    // same as a person going for the disclosure marker.
    await discoveryGroup.locator("> details > summary").click({ position: { x: 4, y: 8 } });
    await discoveryGroup.locator(".wire-exchange").first().locator("summary").click();
    const headers = discoveryGroup.locator(".wire-headers").first();
    await expect(headers).toContainText("mcp-protocol-version");
    await expect(headers).toContainText("2026-07-28");

    // Call analyze-document with the schema-generated form's defaults; the demo's own diagnostics
    // come back as the issue report text plus resource_link chips, in a new group — expanded by
    // default — whose exchange summary shows the SSE contrast (analyze-document reports progress).
    await page.getByRole("button", { name: /^Call / }).click();
    await expect(page.locator(".mcp-result-text")).toContainText("issue report", {
      timeout: 10_000,
    });
    const callGroup = page.locator(".wire-group").last();
    await expect(callGroup.locator(".wire-ct").first()).toContainText("text/event-stream");

    // A resource_link chip issues a real resources/read — one more logged exchange, in its own group.
    const before = await page.locator(".wire-exchange").count();
    await page.getByRole("button", { name: /Reference type mismatch/ }).click();
    await expect(page.locator(".wire-exchange")).toHaveCount(before + 1, { timeout: 10_000 });
  });

  test("explain-diagnostic answers plain JSON, in contrast to analyze-document's SSE stream", async ({
    page,
  }) => {
    await page.goto("mcp?demo=refs");
    await expect(page.locator(".wire-group").first()).toBeVisible({ timeout: 10_000 });

    // The Tool row uses the Configure page's own load-behavior-field pattern, so its accessible
    // name is the visible "Tool" label, not a dedicated class.
    await page
      .getByRole("combobox", { name: "Tool" })
      .selectOption({ label: "Explain a diagnostic code" });
    await page.getByRole("button", { name: /^Call / }).click();

    // The content-type is on the exchange's one-line summary — visible without expanding anything.
    const callGroup = page.locator(".wire-group").last();
    await expect(callGroup.locator(".wire-ct").first()).toContainText("application/json", {
      timeout: 10_000,
    });
  });

  // Under the current config precedence (default < demoConfig < args.config < decisions), a demo's
  // own config is only a default: the MCP page seeds the arguments form's `config` from the URL's
  // (here, default/strict) config, so calling analyze-document against the "fragment" demo with no
  // `fragments=` override genuinely elicits — the demo's `fragments: "root"` default no longer wins
  // unconditionally over an explicit caller config.
  test("the fragment demo with a strict config elicits fragment consent, both tools/call exchanges in one wire group", async ({
    page,
  }) => {
    await page.goto("mcp?demo=fragment");
    await expect(page.getByText(/MCP interface for demo/)).toBeVisible();

    await page.getByRole("button", { name: /^Call / }).click();

    const panel = page.locator(".elicit-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("Document types");
    await panel.locator("select").first().selectOption("root");
    await panel.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByRole("heading", { name: "Result" })).toBeVisible({ timeout: 15_000 });

    // The server asked, then the client answered on a retry: both halves are on the wire, and — since
    // the retry is issued from inside the same call the page already labeled — grouped as one action
    // (discovery group, then a single "Call …" group holding both tools/call exchanges).
    const wire = await page.evaluate(() => document.body.textContent ?? "");
    expect(wire).toContain("input_required");
    expect(wire).toContain("inputResponses");
    await expect(page.locator(".wire-group")).toHaveCount(2);
    await expect(page.locator(".wire-group").last().locator(".wire-exchange")).toHaveCount(2);
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

    // Url-only inputs stay bookmarkable, same as a direct /view?doc= load — no pipeline ever ran on
    // the configure page; McpPage fetches the documents itself.
    await expect(page).toHaveURL(/\/mcp\?doc=/);
    await expect(page.getByText(/MCP interface for: petstore-3\.1\.yaml/)).toBeVisible();
    await expect(page.locator(".wire-group").first()).toBeVisible({ timeout: 10_000 });
  });

  // The user story that motivated the MCP-native redesign: adding real documents by URL — no demo,
  // no scenario, no knowledge that "fragment consent" exists — should still be able to reach the
  // elicitation, because the strict default "Document types" setting now genuinely reaches the tool
  // call instead of being pre-empted by a local pipeline run that fails before /mcp is ever reached.
  test("adding the fragment fixture files by URL and trying them over MCP reaches fragment consent", async ({
    page,
  }) => {
    await page.goto("configure");
    const fixture = (name: string) => new URL(`fixtures/${name}`, page.url()).pathname;

    await page
      .locator(".doc-row")
      .first()
      .locator("input.url")
      .fill(fixture("ref-to-fragment-3.0.yaml"));
    await page.getByRole("button", { name: "+ Add document" }).click();
    await page
      .locator(".doc-row")
      .nth(1)
      .locator("input.url")
      .fill(fixture("pet-pathitem-3.0.yaml"));
    await page.getByRole("button", { name: "+ Add document" }).click();
    await page.locator(".doc-row").nth(2).locator("input.url").fill(fixture("pet-schema-3.0.yaml"));

    // "Document types" is left at its strict default — the whole point is that nobody had to know to
    // widen it before finding out (via the elicitation) that they needed to.
    await page.getByRole("button", { name: "Try it over MCP" }).click();
    await expect(page).toHaveURL(/\/mcp\?doc=/);
    await expect(page.getByText(/MCP interface for: ref-to-fragment-3\.0\.yaml/)).toBeVisible();

    await page.getByRole("button", { name: /^Call / }).click();

    const panel = page.locator(".elicit-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("Document types");
  });

  test("Render OAD from the MCP page opens the same source in the explorer", async ({ page }) => {
    await page.goto("mcp?demo=refs");
    await expect(page.getByText(/MCP interface for demo/)).toBeVisible();

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
    await expect(page.locator(".wire-group").first()).toBeVisible({ timeout: 10_000 });
    expect((await Promise.all(mcpBodies)).some(isMcpModule)).toBe(true);
  });
});
