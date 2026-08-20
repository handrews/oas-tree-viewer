import { expect, test, afterEach } from "vitest";
import { render } from "vitest-browser-svelte";
import McpPage from "../../src/pages/McpPage.svelte";
import { defaultConfig } from "../../src/app/config";
import { session } from "../../src/app/session.svelte";

// A raw-docs handoff (session.mcpDocs) and the current view (session.current) are both in-memory
// state shared across every test in this file — reset them so one test's source never leaks into the
// next (e.g. a lingering handoff would otherwise outrank a later test's plain `demo` request).
afterEach(() => {
  session.mcpDocs = null;
  session.current = null;
});

// End-to-end over a real in-page Client + handler (hosts/browser.ts): connects, lists real
// capabilities, and the wire log shows the actual MCP-required headers on every exchange —
// `MCP-Protocol-Version` and `Mcp-Method` from the start, `Mcp-Name` once a tool is actually called.
test("McpPage connects, lists capabilities, and analyzes a demo with a real wire log", async () => {
  const screen = await render(McpPage, {
    request: { kind: "demo", demoId: "refs" },
    config: defaultConfig,
  });

  await expect.element(screen.getByText(/MCP interface for demo/)).toBeVisible();
  // A demo source has a /view equivalent, so the round trip back to the explorer is offered.
  await expect.element(screen.getByRole("button", { name: "Render OAD" })).toBeVisible();

  // Capabilities loaded over the wire (tools/list etc.) — present in the DOM even though the
  // `<details>` that holds them is collapsed by default (see the dedicated test below).
  await expect
    .poll(() => document.querySelectorAll(".mcp-caps-col code").length, { timeout: 5000 })
    .toBeGreaterThan(0);
  const capsText = Array.from(document.querySelectorAll(".mcp-caps-col"))
    .map((el) => el.textContent)
    .join("\n");
  expect(capsText).toContain("analyze-document");
  expect(capsText).toContain("explain-diagnostic");

  // The wire log already has entries (connect/discover, tools/list, …) with real headers, grouped
  // under the connect/discovery action.
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

  // The tools/call exchange carries Mcp-Name, and (analyze-document reports progress) answered SSE —
  // the content-type is on the exchange's one-line summary too, no expansion needed to see it.
  const exchanges = Array.from(document.querySelectorAll(".wire-exchange"));
  const bodies = exchanges.map((el) => el.textContent ?? "");
  expect(bodies.some((t) => t.includes("mcp-name") && t.includes("analyze-document"))).toBe(true);
  expect(bodies.some((t) => t.includes("text/event-stream"))).toBe(true);
  const summaryContentTypes = Array.from(document.querySelectorAll(".wire-ct")).map(
    (el) => el.textContent,
  );
  expect(summaryContentTypes.some((t) => t?.includes("text/event-stream"))).toBe(true);

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

// The cold picker has nothing to render, so there's no round trip back to the explorer.
test("Render OAD is hidden for the cold picker", async () => {
  const screen = await render(McpPage, { request: null, config: defaultConfig });

  await expect.element(screen.getByText("Choose a demo to analyze")).toBeVisible();
  expect(document.querySelector(".mcp-view-open")).toBeNull();
});

// A raw-docs handoff (ConfigurePage's MCP-native "Try it over MCP" for a source with an upload) was
// never resolved into session.result, so /view would just show its empty state — the back-link hides.
test("Render OAD is hidden for a raw-docs handoff with no session.result to reproduce it from", async () => {
  session.mcpDocs = {
    docs: [
      {
        filename: "entry.yaml",
        text: "openapi: 3.1.0\ninfo: { title: T, version: '1' }\npaths: {}\n",
        isEntry: true,
      },
    ],
    config: defaultConfig,
    request: { kind: "session" },
  };
  const screen = await render(McpPage, { request: null, config: defaultConfig });

  await expect.element(screen.getByText(/MCP interface for: entry\.yaml/)).toBeVisible();
  expect(document.querySelector(".mcp-view-open")).toBeNull();
});

// The capabilities panel is the server's advertised surface, not something you act on — it stays
// collapsed under a <details> until asked for, which <details>/<summary> gives for free.
test("Capabilities is collapsed by default and opens on click", async () => {
  const screen = await render(McpPage, {
    request: { kind: "demo", demoId: "refs" },
    config: defaultConfig,
  });
  await expect.element(screen.getByText(/MCP interface for demo/)).toBeVisible();

  await expect
    .poll(() => document.querySelector(".mcp-caps-details"), { timeout: 5000 })
    .not.toBeNull();
  const details = document.querySelector(".mcp-caps-details") as HTMLDetailsElement;
  expect(details.open).toBe(false);

  details.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(details.open).toBe(true);
});

// WireLog groups exchanges by the action that caused them (see beginAction in hosts/browser.ts): the
// connect/discovery group is there from the start, collapsed by default, and a new expanded group
// appears every time the page issues a labeled action.
test("the wire log groups exchanges — a collapsed discovery group, then one expanded group per call", async () => {
  const screen = await render(McpPage, {
    request: { kind: "demo", demoId: "refs" },
    config: defaultConfig,
  });
  await expect.element(screen.getByText(/MCP interface for demo/)).toBeVisible();

  await expect
    .poll(() => document.querySelectorAll(".wire-group").length, { timeout: 5000 })
    .toBeGreaterThan(0);
  const groupDetails = () =>
    Array.from(document.querySelectorAll(".wire-group > details")) as HTMLDetailsElement[];
  expect(groupDetails()[0]!.open).toBe(false);
  expect(groupDetails()[0]!.querySelector("summary")?.textContent).toMatch(/discover capabilities/);

  await screen.getByRole("button", { name: /^Call / }).click();

  await expect
    .poll(() => document.querySelectorAll(".wire-group").length, { timeout: 5000 })
    .toBeGreaterThan(1);
  const callGroup = groupDetails().at(-1)!;
  expect(callGroup.open).toBe(true);
  expect(callGroup.querySelector("summary")?.textContent).toMatch(/^Call /);
  expect(callGroup.querySelectorAll(".wire-exchange").length).toBeGreaterThan(0);
});

// The result slot sits directly beneath the call form in the DOM — the structural pairing the
// workbench layout is built around (calling and its result read as one action, side by side with the
// wire log rather than buried under a capabilities panel).
test("the result section renders immediately after the call section in the DOM", async () => {
  const screen = await render(McpPage, {
    request: { kind: "demo", demoId: "refs" },
    config: defaultConfig,
  });
  await expect.element(screen.getByText(/MCP interface for demo/)).toBeVisible();

  await expect
    .poll(() => document.querySelector(".mcp-call-section"), { timeout: 5000 })
    .not.toBeNull();
  const callSection = document.querySelector(".mcp-call-section")!;
  const resultSection = document.querySelector(".mcp-result-section")!;
  expect(resultSection).not.toBeNull();
  expect(callSection.nextElementSibling).toBe(resultSection);
  // Both live in the workbench's left column, not sharing DOM proximity with the wire log.
  expect(callSection.closest(".mcp-workbench-main")).not.toBeNull();
  expect(resultSection.closest(".mcp-workbench-main")).not.toBeNull();
});

// The "Call a tool" section for analyze-document reuses the Configure page's own shared widgets
// (src/ui/DocumentTypesSelect.svelte, src/ui/ResolutionOptions.svelte) rather than a schema-generated
// lookalike, so the same setting reads identically — and is discoverable by the same classes — on
// both pages.
test("the Call a tool section reuses the Configure page's shared config widgets", async () => {
  const screen = await render(McpPage, {
    request: { kind: "demo", demoId: "refs" },
    config: defaultConfig,
  });
  await expect.element(screen.getByText(/MCP interface for demo/)).toBeVisible();

  await expect
    .poll(() => document.querySelector(".mcp-call-section .load-behavior"), { timeout: 5000 })
    .not.toBeNull();
  const callSection = document.querySelector(".mcp-call-section")!;

  // Document types: the first .load-behavior-field in DOM order (the Tool row, restyled to the same
  // pattern, is the second).
  const docTypesField = callSection.querySelector(".load-behavior-field")!;
  expect(docTypesField.querySelector(".load-behavior-label")?.textContent).toBe("Document types");
  expect(docTypesField.querySelector("select.load-behavior")).not.toBeNull();

  // Minimum severity: an English label using the same .option classes as the Configure page's
  // resolution options.
  const severityLabel = Array.from(callSection.querySelectorAll(".option-label")).find(
    (el) => el.textContent === "Minimum severity",
  );
  expect(severityLabel).toBeTruthy();

  // Resolution options: the shared collapsed <details>.
  expect(callSection.querySelector(".resolution-options")).not.toBeNull();
});
