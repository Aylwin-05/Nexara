import { useEffect, useRef } from "react";

/**
 * Hook that detects when the app goes to background / foreground
 * and calls the provided callbacks. Useful for reconnecting
 * WebSockets and flushing offline queues.
 *
 * Supports both web (visibilitychange / online / offline)
 * and Capacitor native shells (@capacitor/app) when available.
 *
 * @param {object} opts
 * @param {Function} [opts.onForeground] - called when page becomes visible
 * @param {Function} [opts.onBackground] - called when page becomes hidden
 * @param {Function} [opts.onOnline]     - called when navigator goes online
 * @param {Function} [opts.onOffline]    - called when navigator goes offline
 */
export function useAppLifecycle({
    onForeground,
    onBackground,
    onOnline,
    onOffline,
} = {}) {
    const callbacksRef = useRef({ onForeground, onBackground, onOnline, onOffline });

    useEffect(() => {
        callbacksRef.current = { onForeground, onBackground, onOnline, onOffline };
    }, [onForeground, onBackground, onOnline, onOffline]);

    useEffect(() => {
        // --- Web lifecycle ---
        const handleVisibility = () => {
            if (document.hidden) {
                callbacksRef.current.onBackground?.();
            } else {
                callbacksRef.current.onForeground?.();
            }
        };

        const handleOnline = () => callbacksRef.current.onOnline?.();
        const handleOffline = () => callbacksRef.current.onOffline?.();

        document.addEventListener("visibilitychange", handleVisibility);
        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        // --- Capacitor lifecycle ---
        let capacitorRemove;

        async function initCapacitor() {
            try {
                const { App } = await import("@capacitor/app");
                const handle = await App.addListener(
                    "appStateChange",
                    ({ isActive }) => {
                        if (isActive) {
                            callbacksRef.current.onForeground?.();
                        } else {
                            callbacksRef.current.onBackground?.();
                        }
                    }
                );
                capacitorRemove = () => handle.remove();
            } catch {
                // Not in a Capacitor shell — no-op
            }
        }

        initCapacitor();

        return () => {
            document.removeEventListener("visibilitychange", handleVisibility);
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            capacitorRemove?.();
        };
    }, []);
}
