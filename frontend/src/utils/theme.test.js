import { describe, it, expect, beforeEach } from "vitest";
import { getTheme, applyTheme, setTheme, THEMES } from "./theme.js";

describe("theme", () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute("data-theme");
    });

    describe("getTheme", () => {
        it("defaults to 'blue' when nothing stored", () => {
            expect(getTheme()).toBe("blue");
        });

        it("returns stored theme if valid", () => {
            localStorage.setItem("nexara_theme", "dark");
            expect(getTheme()).toBe("dark");
        });

        it("falls back to 'blue' for invalid stored value", () => {
            localStorage.setItem("nexara_theme", "neon");
            expect(getTheme()).toBe("blue");
        });
    });

    describe("applyTheme", () => {
        it("removes data-theme attribute for 'blue'", () => {
            applyTheme("dark");
            expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
            applyTheme("blue");
            expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
        });

        it("sets data-theme for 'dark' and 'light'", () => {
            applyTheme("dark");
            expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
            applyTheme("light");
            expect(document.documentElement.getAttribute("data-theme")).toBe("light");
        });

        it("falls back to 'blue' for invalid theme", () => {
            applyTheme("invalid");
            expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
        });
    });

    describe("setTheme", () => {
        it("persists to localStorage and applies", () => {
            setTheme("light");
            expect(localStorage.getItem("nexara_theme")).toBe("light");
            expect(document.documentElement.getAttribute("data-theme")).toBe("light");
        });
    });

    describe("THEMES constant", () => {
        it("contains exactly blue, dark, light", () => {
            expect(THEMES).toEqual(["blue", "dark", "light"]);
        });
    });
});
