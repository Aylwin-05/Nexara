// ==========================================================
// The one place that answers "which app am I running in?"
// ==========================================================
//
// The same bundle is shipped twice: as the web app (served by nginx
// / the Vite dev server) and as the payload for the Capacitor
// Android WebView, whose origin is https://localhost.
//
// Layout used to be decided twice, two different ways:
//
//   CSS  -> @media (max-width: 720px), plus an html.native
//           override so a WebView that reports >720px still gets
//           the phone layout
//   JS   -> window.matchMedia("(max-width: 720px)").matches
//
// Those disagree whenever the WebView reports a wide viewport: CSS
// renders the phone shell (bottom tab bar, single pane) while React
// still builds the desktop slider/rail DOM. So every caller now asks
// this module, and both sides agree because the rule is the same rule
// the html.native block in mobile.css encodes.
// ==========================================================

/** Viewport width at or below which the phone layout is used. */
export const PHONE_BREAKPOINT = 720;

const PHONE_QUERY = `(max-width: ${PHONE_BREAKPOINT}px)`;

/** True inside the native Capacitor shell. Absent in a real browser. */
export function isNative() {
    return (
        typeof window !== "undefined" &&
        window.Capacitor?.isNativePlatform?.() === true
    );
}

/**
 * True when the UI should use the phone layout.
 *
 * Native always counts as a phone regardless of the width the
 * WebView reports, matching the `html.native` rules in mobile.css.
 */
export function isPhoneViewport() {
    if (isNative()) {
        return true;
    }

    return (
        typeof window !== "undefined" &&
        window.matchMedia(PHONE_QUERY).matches
    );
}

const PHONE_WIDE_QUERY = `(min-width: ${PHONE_BREAKPOINT + 1}px)`;

/**
 * True only on the roomy two-pane web layout. The exact inverse of
 * isPhoneViewport(), so the two can never disagree.
 */
export function isDesktopViewport() {
    if (isNative()) {
        return false;
    }

    return (
        typeof window !== "undefined" &&
        window.matchMedia(PHONE_WIDE_QUERY).matches
    );
}

/**
 * Subscribe to layout changes. Calls back immediately with the
 * current answer, then on every change.
 */
export function subscribeToLayout(onChange) {
    if (typeof window === "undefined") {
        return () => {};
    }

    const mql = window.matchMedia(PHONE_QUERY);
    const handler = () => onChange(isPhoneViewport());
    mql.addEventListener("change", handler);
    onChange(isPhoneViewport());

    return () => mql.removeEventListener("change", handler);
}

/** "android" / "ios" in the native shell, else null. */
export function nativePlatform() {
    if (!isNative()) {
        return null;
    }

    return window.Capacitor?.getPlatform?.() ?? null;
}
