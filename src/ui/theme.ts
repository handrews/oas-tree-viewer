// Light/dark theme helpers: a data-theme on <html> drives the CSS token sets. The
// initial theme follows a stored choice, else the OS preference. Colors all live in
// CSS custom properties, so a theme switch is just the attribute flip — nothing
// re-renders. The toggle button itself lives in ThemeToggle.svelte.

export type Theme = "light" | "dark";

const STORAGE_KEY = "oas-tree-viewer:theme";

/** The theme to use on load: an explicit stored choice, else the OS preference. */
export function initialTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === "light" || stored === "dark") return stored;
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

/** The theme currently applied to <html>. */
export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Apply a theme by flipping the data-theme attribute the CSS reads. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Apply a theme and remember the choice (best-effort; storage may be unavailable). */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the choice just won't persist.
  }
}
