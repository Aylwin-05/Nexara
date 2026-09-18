import { useEffect } from "react";

// ==========================================================
// Android hardware back-button coordination.
//
// Components push handlers onto a stack while they have
// something "closable" open (menus, modals, the chat view,
// tab pages). The native backButton event walks the stack
// from the top; the first handler that returns true has
// consumed the press. If nothing consumes it the user is at
// the app root, so we hand control back to the OS (exit).
//
// Handlers must be registered only while their overlay is
// actually open — use useAndroidBack(fn, isActive).
// ==========================================================

const stack = [];

export function useAndroidBack(handler, active = true) {
    useEffect(() => {

        if (!active) return;

        stack.push(handler);

        return () => {
            const index = stack.indexOf(handler);
            if (index !== -1) stack.splice(index, 1);
        };

    }, [handler, active]);
}

export function initAndroidBack() {

    if (!window.Capacitor?.isNativePlatform?.()) return;

    const App = window.Capacitor?.Plugins?.App;

    if (!App?.addListener) return;

    App.addListener("backButton", () => {

        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i]()) return;
        }

        // Nothing left to close — behave like the stock
        // launcher behaviour and leave the app.
        App.exitApp();

    });

}
