// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initialTheme, currentTheme, applyTheme, setTheme } from "../../src/ui/theme";

const root = document.documentElement;

beforeEach(() => {
  root.removeAttribute("data-theme");
  localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("initialTheme", () => {
  it("defaults to dark with no stored choice and no matchMedia", () => {
    expect(initialTheme()).toBe("dark");
  });

  it("honors a stored theme", () => {
    localStorage.setItem("oas-tree-viewer:theme", "light");
    expect(initialTheme()).toBe("light");
  });

  it("falls back to the OS preference when nothing is stored", () => {
    (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (q) => ({
      matches: q.includes("light"),
    });
    expect(initialTheme()).toBe("light");
  });
});

describe("applyTheme / currentTheme / setTheme", () => {
  it("applyTheme sets the attribute and currentTheme reads it", () => {
    applyTheme("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(currentTheme()).toBe("light");
    applyTheme("dark");
    expect(currentTheme()).toBe("dark");
  });

  it("setTheme applies and persists the choice", () => {
    setTheme("light");
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("oas-tree-viewer:theme")).toBe("light");
  });
});
