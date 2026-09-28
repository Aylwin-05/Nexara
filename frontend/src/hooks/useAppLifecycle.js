import { useEffect, useRef } from "react";

import { isNative } from "../utils/platform";

/**
 * Hook that detects when the app goes to background / foreground
 * and calls the provided callbacks. Useful for reconnecting
 * WebSockets and flushing offline queues.
 *
 * Web uses visibilitychange / online / offline. The Capacitor
 * shell additionally gets @capacitor/app's appStateChange, which
 * is registered only when isNative() — see the note at the
 * registration site for why it must not run on the web too.
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

        // --- Capacitor lifecycle (native shell only) ---
        let capacitorRemove;

        // Only the shell gets the Capacitor listener. Registering it
        // on the web as well meant BOTH paths fired for one physical
        // background event, because Capacitor's own web shim also
        // listens to visibilitychange and re-emits appStateChange.
        // ChatSocketContext then reconnected twice, and the second
        // connect() closed the still-CONNECTING first socket.
        if (isNative()) {
            void (async () => {
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
                    // Plugin unavailable — no-op
                }
            })();
        }

        return () => {
            document.removeEventListener("visibilitychange", handleVisibility);
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            capacitorRemove?.();
        };
    }, []);
}
