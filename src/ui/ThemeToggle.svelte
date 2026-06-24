<script lang="ts">
  // Header toggle for light/dark. The theme state lives on <html data-theme>; this
  // button reads the current value, flips it, and remembers the choice.
  import { currentTheme, setTheme, type Theme } from "./theme";

  let theme = $state<Theme>(currentTheme());
  const target = $derived<Theme>(theme === "dark" ? "light" : "dark");

  function toggle(): void {
    const next: Theme = theme === "dark" ? "light" : "dark";
    theme = next;
    setTheme(next);
  }
</script>

<button
  type="button"
  class="theme-toggle"
  aria-pressed={theme === "dark" ? "true" : "false"}
  aria-label={`Switch to ${target} theme`}
  title={`Switch to ${target} theme`}
  onclick={toggle}>{theme === "dark" ? "☾" : "☀"}</button
>
