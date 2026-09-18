import { useEffect, useState, useCallback } from "react";
import { screenSecurity } from "../utils/screenSecurity";

// ==========================================================
// useScreenSecurity
//
// Privacy-first screen guard: when the tab/window loses focus
// (or is otherwise not visible) and the user has opted into
// privacy blur, the hook returns `blurred = true`.  Callers add
// a CSS class that blurs/blanks the sensitive chat content, so
// the OS app-switcher snapshot never reveals a message.
// ==========================================================

export default function useScreenSecurity() {

    const [
        enabled,
        setEnabled,
    ] = useState(
        screenSecurity.isPrivacyBlurEnabled()
    );

    const [
        blurred,
        setBlurred,
    ] = useState(false);

    useEffect(() => {

        const update = () => {
            setBlurred(
                enabled &&
                (
                    typeof document === "undefined" ||
                    document.hidden ||
                    !document.hasFocus()
                )
            );
        };

        update();

        document.addEventListener(
            "visibilitychange", update
        );
        window.addEventListener("blur", update);
        window.addEventListener("focus", update);

        return () => {
            document.removeEventListener(
                "visibilitychange", update
            );
            window.removeEventListener("blur", update);
            window.removeEventListener("focus", update);
        };

    }, [enabled]);

    const setEnabledAndPersist = useCallback((value) => {
        screenSecurity.setPrivacyBlurEnabled(value);
        setEnabled(value);
    }, []);

    return {
        enabled,
        setEnabled: setEnabledAndPersist,
        blurred,
    };
}
