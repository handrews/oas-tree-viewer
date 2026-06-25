import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import ConfigurePage from "../../src/pages/ConfigurePage.svelte";
import { demos } from "../../src/app/demos";

// Smoke test: the configure page surfaces the source form and a button per demo. The
// navigation it triggers is exercised end-to-end in the Playwright e2e suite.
test("ConfigurePage shows the source form and one button per demo", async () => {
  render(ConfigurePage);

  expect(document.querySelector(".oad-form")).not.toBeNull();
  // The render action now lives inside the resolution-options box, outside the form (it submits the
  // form by id), and a load-behavior selector sits above the documents.
  const loadBehavior = document.querySelector(".load-behavior");
  expect(loadBehavior).not.toBeNull();
  const renderBtn = document.querySelector(".resolution-box .render") as HTMLButtonElement | null;
  expect(renderBtn).not.toBeNull();
  expect(renderBtn!.getAttribute("form")).toBe("oad-form");

  // The document list and the resolution options are framed together in one group box, and the
  // load-behavior select carries a visible left-hand "Document types" label as its accessible name.
  const group = document.querySelector(".config-group");
  expect(group).not.toBeNull();
  expect(group!.querySelector(".oad-form")).not.toBeNull();
  expect(group!.querySelector(".resolution-box")).not.toBeNull();
  expect(loadBehavior!.closest("label")?.querySelector(".load-behavior-label")?.textContent).toBe(
    "Document types",
  );

  const buttons = [...document.querySelectorAll(".demo-open")];
  expect(buttons).toHaveLength(demos.length);
  const labels = buttons.map((b) => b.textContent?.trim());
  for (const d of demos) expect(labels).toContain(d.label);
});
