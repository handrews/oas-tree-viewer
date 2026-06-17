import { expect, test, beforeEach } from "vitest";
import { render } from "vitest-browser-svelte";
import ThemeToggle from "../../src/ui/ThemeToggle.svelte";
import { applyTheme } from "../../src/ui/theme";

beforeEach(() => {
  localStorage.clear();
});

test("reflects the current theme and toggles on click", async () => {
  applyTheme("dark");
  const screen = render(ThemeToggle);

  const toLight = screen.getByRole("button", { name: "Switch to light theme" });
  await expect.element(toLight).toHaveTextContent("☾");

  await toLight.click();

  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(localStorage.getItem("oas-tree-viewer:theme")).toBe("light");
  await expect
    .element(screen.getByRole("button", { name: "Switch to dark theme" }))
    .toHaveTextContent("☀");
});
