// Light/dark theme: applies a data-theme on <html> (read by the CSS token sets),
// defaulting to the OS preference and remembering an explicit choice. Renders a
// small toggle into the header. Colors all live in CSS custom properties, so a
// theme switch is just the attribute flip — nothing re-renders.

export type Theme = "light" | "dark";

const STORAGE_KEY = "oas-tree-viewer:theme";

/** Apply the initial theme and mount the toggle button into `header`. */
export function setupTheme(header: HTMLElement): void {
  applyTheme(initialTheme());

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-toggle";

  const sync = (): void => {
    const dark = currentTheme() === "dark";
    btn.textContent = dark ? "☾" : "☀";
    btn.setAttribute("aria-pressed", String(dark));
    const target = dark ? "light" : "dark";
    btn.setAttribute("aria-label", `Switch to ${target} theme`);
    btn.title = `Switch to ${target} theme`;
  };

  btn.addEventListener("click", () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice just won't persist.
    }
    sync();
  });

  header.appendChild(btn);
  sync();
}

function initialTheme(): Theme {
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

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}
