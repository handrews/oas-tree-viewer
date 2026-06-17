// Application entry: apply the theme before paint, then mount the Svelte app.

import "./styles.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { applyTheme, initialTheme } from "./ui/theme";

// Apply the saved/OS theme before mount so there is no flash of the wrong theme.
applyTheme(initialTheme());

mount(App, { target: document.getElementById("root")! });
