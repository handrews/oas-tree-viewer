import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import McpPage from "../../src/pages/McpPage.svelte";
import { defaultConfig } from "../../src/app/config";

// End-to-end over a real in-page Client + handler (hosts/browser.ts): connects, lists real
// capabilities, and the wire log shows the actual MCP-required headers on every exchange —
// `MCP-Protocol-Version` and `Mcp-Method` from the start, `Mcp-Name` once a tool is actually called.
test("McpPage connects, lists capabilities, and analyzes a demo with a real wire log", async () => {
  const screen = await render(McpPage, {
    request: { kind: "demo", demoId: "refs" },
    config: defaultConfig,
  });

  await expect.element(screen.getByText(/Analyzing demo/)).toBeVisible();
  // A demo source has a /view equivalent, so the round trip back to the explorer is offered.
  await expect.element(screen.getByRole("button", { name: "Render OAD" })).toBeVisible();

  // Capabilities loaded over the wire (tools/list etc.).
  await expect
    .poll(() => document.querySelectorAll(".mcp-caps-col code").length, { timeout: 5000 })
    .toBeGreaterThan(0);
  const capsText = Array.from(document.querySelectorAll(".mcp-caps-col"))
    .map((el) => el.textContent)
    .join("\n");
  expect(capsText).toContain("analyze-document");
  expect(capsText).toContain("explain-diagnostic");

  // The wire log already has entries (server/discover, tools/list, …) with real headers.
  await expect
    .poll(() => document.querySelectorAll(".wire-exchange").length, { timeout: 5000 })
    .toBeGreaterThan(0);
  const headerText = Array.from(document.querySelectorAll(".wire-headers"))
    .map((el) => el.textContent)
    .join("\n");
  expect(headerText).toContain("mcp-protocol-version");
  expect(headerText).toContain("2026-07-28");
  expect(headerText).toContain("mcp-method");

  // Call analyze-document with the schema-generated form's defaults.
  await screen.getByRole("button", { name: /^Call / }).click();

  await expect
    .poll(() => document.querySelector(".mcp-result-text")?.textContent, { timeout: 5000 })
    .toMatch(/issue report/);
  expect(document.querySelector(".mcp-structured summary")?.textContent).toBe("Structured content");

  // The tools/call exchange carries Mcp-Name, and (analyze-document reports progress) answered SSE.
  const exchanges = Array.from(document.querySelectorAll(".wire-exchange"));
  const bodies = exchanges.map((el) => el.textContent ?? "");
  expect(bodies.some((t) => t.includes("mcp-name") && t.includes("analyze-document"))).toBe(true);
  expect(bodies.some((t) => t.includes("text/event-stream"))).toBe(true);

  // A resource_link chip is real: clicking it issues a genuine resources/read, adding a new exchange.
  const before = document.querySelectorAll(".wire-exchange").length;
  await screen
    .getByRole("button", { name: /Reference/ })
    .first()
    .click();
  await expect
    .poll(() => document.querySelectorAll(".wire-exchange").length, { timeout: 5000 })
    .toBeGreaterThan(before);
});

// Neither the cold picker (nothing to render) nor a scenario (inline-only, no /view equivalent) has
// a round trip back to the explorer.
test("Render OAD is hidden for the cold picker and a scenario", async () => {
  const screen = await render(McpPage, { request: null, config: defaultConfig });

  await expect.element(screen.getByText("Choose a demo to analyze")).toBeVisible();
  expect(document.querySelector(".mcp-view-open")).toBeNull();

  await screen.getByRole("button", { name: "A document fragment" }).click();
  await expect.element(screen.getByText(/Analyzing scenario/)).toBeVisible();
  expect(document.querySelector(".mcp-view-open")).toBeNull();
});
