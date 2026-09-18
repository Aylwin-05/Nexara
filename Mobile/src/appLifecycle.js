import { App } from "@capacitor/app";

/**
 * Registers Capacitor App lifecycle listeners.
 * When the app goes to background, the WS connection is paused;
 * when it comes back to foreground, the connection is re-established
 * and the offline outbox is flushed.
 *
 * Safe to call from the web too (Capacitor plugins no-op when not running in a native shell).
 */
export function registerAppLifecycle({ onForeground, onBackground } = {}) {
    let cleanup;

    App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
            onForeground?.();
        } else {
            onBackground?.();
        }
    }).then((handle) => {
        cleanup = handle;
    });

    return () => {
        cleanup?.remove?.();
    };
}

/**
 * Returns the current app state (active / inactive).
 * On web, falls back to document.visibilityState.
 */
export async function getAppState() {
    try {
        const state = await App.getState();
        return state.isActive;
    } catch {
        return document.visibilityState === "visible";
    }
}
