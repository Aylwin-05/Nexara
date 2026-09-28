// ==========================================================
// Theme management (blue / dark / light)
//
// "blue" is the default design; "dark" and "light" are applied
// by setting data-theme on <html>, which switches the CSS
// variable blocks in index.css.
// ==========================================================

import { storageGet, storageSet } from "./storage.js";

const THEME_KEY = "nexara_theme";

export const THEMES = ["blue", "dark", "light"];

export function getTheme() {
    // Guarded: main.jsx calls this before createRoot, so a throwing
    // localStorage would blank the app on a WebView with storage
    // disabled.
    const stored = storageGet(THEME_KEY);

    return THEMES.includes(stored) ? stored : "blue";
}

export function applyTheme(theme) {
    const resolved = THEMES.includes(theme) ? theme : "blue";

    if (resolved === "blue") {
        document.documentElement.removeAttribute("data-theme");
    }
    else {
        document.documentElement.setAttribute(
            "data-theme",
            resolved
        );
    }
}

export function setTheme(theme) {
    storageSet(THEME_KEY, theme);

    applyTheme(theme);
}
