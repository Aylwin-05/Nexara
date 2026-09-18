// ==========================================================
// Theme management (blue / dark / light)
//
// "blue" is the default design; "dark" and "light" are applied
// by setting data-theme on <html>, which switches the CSS
// variable blocks in index.css.
// ==========================================================

const THEME_KEY = "nexara_theme";

export const THEMES = ["blue", "dark", "light"];

export function getTheme() {
    const stored = localStorage.getItem(THEME_KEY);

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
    localStorage.setItem(THEME_KEY, theme);

    applyTheme(theme);
}
