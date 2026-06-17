// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupTheme } from "../../src/ui/theme";

const root = document.documentElement;

beforeEach(() => {
  root.removeAttribute("data-theme");
  document.body.innerHTML = "";
  localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

function mount(): HTMLButtonElement {
  const header = document.createElement("header");
  document.body.appendChild(header);
  setupTheme(header);
  return header.querySelector<HTMLButtonElement>(".theme-toggle")!;
}

describe("setupTheme", () => {
  it("defaults to dark (no stored choice, no matchMedia) and renders a toggle", () => {
    const btn = mount();
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.getAttribute("aria-label")).toBe("Switch to light theme");
    expect(btn.textContent).toBe("☾");
  });

  it("toggles to light, persists the choice, and updates the button", () => {
    const btn = mount();
    btn.click();
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("oas-tree-viewer:theme")).toBe("light");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.getAttribute("aria-label")).toBe("Switch to dark theme");
    btn.click();
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("honors a stored theme on init", () => {
    localStorage.setItem("oas-tree-viewer:theme", "light");
    mount();
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("falls back to the OS preference when nothing is stored", () => {
    (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (q) => ({
      matches: q.includes("light"),
    });
    mount();
    expect(root.getAttribute("data-theme")).toBe("light");
  });
});
