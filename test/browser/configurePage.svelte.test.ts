import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import ConfigurePage from "../../src/pages/ConfigurePage.svelte";
import { demos } from "../../src/app/demos";

// Smoke test: the configure page surfaces the source form and a button per demo. The
// navigation it triggers is exercised end-to-end in the Playwright e2e suite.
test("ConfigurePage shows the source form and one button per demo", async () => {
  render(ConfigurePage);

  expect(document.querySelector(".oad-form")).not.toBeNull();
  expect(document.querySelector(".oad-form .render")).not.toBeNull();

  const buttons = [...document.querySelectorAll(".demo-open")];
  expect(buttons).toHaveLength(demos.length);
  const labels = buttons.map((b) => b.textContent?.trim());
  for (const d of demos) expect(labels).toContain(d.label);
});
