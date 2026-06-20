import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Legend from "../../src/render/Legend.svelte";

test("renders every legend section and representative entries", async () => {
  const screen = render(Legend);

  for (const heading of [
    "Object groups",
    "Node shapes",
    "References",
    "Connection lines",
    "Error icons",
    "Documents",
  ]) {
    await expect.element(screen.getByText(heading)).toBeVisible();
  }

  // A representative entry from several sections.
  await expect.element(screen.getByText("Structural")).toBeVisible();
  await expect.element(screen.getByText("HTTP")).toBeVisible();
  await expect.element(screen.getByText("Data modeling")).toBeVisible();
  await expect.element(screen.getByText(/URI-reference/)).toBeVisible();
  await expect.element(screen.getByText(/Implicit connection/)).toBeVisible();
  await expect.element(screen.getByText(/Type mismatch/)).toBeVisible();
  await expect.element(screen.getByText(/not reachable/)).toBeVisible();
});
