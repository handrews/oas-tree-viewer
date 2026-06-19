import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import ViewPage from "../../src/pages/ViewPage.svelte";

// Smoke test: given a demo request, the view page loads the demo's same-origin fixtures
// (served from public/), runs the load → resolve pipeline, and renders the tree plus the
// issue drawer. This exercises the whole request → pipeline → render path in a real browser.
test("ViewPage loads a demo by request and renders the tree + issue drawer", async () => {
  render(ViewPage, { request: { kind: "demo", demoId: "refs" } });

  // The refs demo loads two documents, so two trees render.
  await expect
    .poll(() => document.querySelectorAll("svg.tree-canvas g.doc").length, { timeout: 5000 })
    .toBe(2);
  // It has unresolved references, so the issue drawer appears.
  await expect.poll(() => document.querySelector("#issues")).not.toBeNull();
});

test("ViewPage shows an error state for an unknown demo", async () => {
  render(ViewPage, { request: { kind: "demo", demoId: "does-not-exist" } });

  await expect.poll(() => document.querySelector(".view-error")).not.toBeNull();
  expect(document.querySelector(".view-back")).not.toBeNull();
});
