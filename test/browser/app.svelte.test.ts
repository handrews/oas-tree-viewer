import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import App from "../../src/App.svelte";
import { router } from "../../src/app/router.svelte";
import { defaultConfig } from "../../src/app/config";

// Shell smoke test: App mounts, the imperative form + theme toggle come up via onMount,
// and the viewer starts hidden. Runs in a real browser (Vitest browser mode).
test("App mounts the shell: header, form, and theme toggle", async () => {
  const screen = await render(App);

  await expect
    .element(screen.getByRole("heading", { name: "OpenAPI Description Structure Viewer" }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Render OAD" })).toBeVisible();
  // setupTheme() appended the toggle into the header during onMount.
  await expect.element(screen.getByRole("button", { name: /Switch to .+ theme/ })).toBeVisible();
});

// The heading only makes sense as a link away from the configure page — clicking it there
// (Playwright, e2e/mcp.spec.ts) would be a no-op back to the page already shown.
test("the heading is not a link on the configure page", async () => {
  router.route = { page: "configure" };
  await render(App);

  expect(document.querySelector("#app-header h1 a")).toBeNull();
});

test("the heading is a base-aware link to /configure on other routes", async () => {
  router.route = {
    page: "view",
    request: { kind: "demo", demoId: "refs" },
    config: defaultConfig,
  };
  await render(App);

  const link = document.querySelector<HTMLAnchorElement>("#app-header h1 a");
  expect(link).not.toBeNull();
  expect(link!.textContent?.trim()).toBe("OpenAPI Description Structure Viewer");
  // No sub-path base configured for this test build, so the href is root-relative — the
  // click-navigation itself (and its base-path handling) is exercised in the e2e suite.
  expect(link!.getAttribute("href")).toBe("/configure");
});
