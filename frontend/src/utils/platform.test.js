import { describe, it, expect, afterEach } from "vitest";

import {
    isDesktopViewport,
    isNative,
    isPhoneViewport,
    nativePlatform,
    subscribeToLayout,
} from "./platform";

const CAPACITOR_NATIVE = { isNativePlatform: () => true, getPlatform: () => "android" };

function setViewportWidth(width) {
    window.matchMedia = vi.fn((query) => {
        const max = query.match(/max-width:\s*(\d+)px/);
        const min = query.match(/min-width:\s*(\d+)px/);
        return {
            matches: max ? width <= Number(max[1]) : min ? width >= Number(min[1]) : false,
            addEventListener: () => {},
            removeEventListener: () => {},
        };
    });
}

afterEach(() => {
    delete window.Capacitor;
});

describe("platform", () => {
    it("treats a narrow web viewport as a phone", () => {
        setViewportWidth(390);
        expect(isNative()).toBe(false);
        expect(isPhoneViewport()).toBe(true);
        expect(isDesktopViewport()).toBe(false);
    });

    it("treats a wide web viewport as desktop", () => {
        setViewportWidth(1280);
        expect(isPhoneViewport()).toBe(false);
        expect(isDesktopViewport()).toBe(true);
    });

    // The regression this module exists for: a WebView reporting a
    // WIDE viewport used to get the phone CSS (html.native) but the
    // desktop DOM, because JS only asked matchMedia.
    it("treats native as a phone even when the WebView reports a wide viewport", () => {
        setViewportWidth(1280);
        window.Capacitor = CAPACITOR_NATIVE;
        expect(isPhoneViewport()).toBe(true);
        expect(isDesktopViewport()).toBe(false);
    });

    it("keeps phone and desktop mutually exclusive across the boundary", () => {
        for (const width of [320, 720, 721, 1920]) {
            setViewportWidth(width);
            expect(isPhoneViewport()).not.toBe(isDesktopViewport());
        }
    });

    it("reports the native platform only in the shell", () => {
        setViewportWidth(390);
        expect(nativePlatform()).toBeNull();
        window.Capacitor = CAPACITOR_NATIVE;
        expect(nativePlatform()).toBe("android");
    });

    it("subscribeToLayout reports immediately and can be detached", () => {
        setViewportWidth(390);
        let seen;
        const off = subscribeToLayout((v) => { seen = v; });
        expect(seen).toBe(true);
        expect(() => off()).not.toThrow();
    });
});
