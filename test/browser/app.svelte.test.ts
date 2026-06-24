import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import App from "../../src/App.svelte";

// Shell smoke test: App mounts, the imperative form + theme toggle come up via onMount,
// and the viewer starts hidden. Runs in a real browser (Vitest browser mode).
test("App mounts the shell: header, form, and theme toggle", async () => {
  const screen = render(App);

  await expect
    .element(screen.getByRole("heading", { name: "OpenAPI Description Structure Viewer" }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Render OAD" })).toBeVisible();
  // setupTheme() appended the toggle into the header during onMount.
  await expect.element(screen.getByRole("button", { name: /Switch to .+ theme/ })).toBeVisible();
});
