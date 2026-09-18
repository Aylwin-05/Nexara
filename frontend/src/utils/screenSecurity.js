// ==========================================================
// Screen security (privacy-first guards)
//
// True screenshot prevention is impossible in a standard web
// page (only a TWA on Android with FLAG_SECURE can do it).
// What we CAN do, privacy-first like WhatsApp/Telegram:
//   1. Blank/blur on-screen chat content when the app loses
//      focus (tab switch, window minimize) so the cached
//      snapshot / app switcher does not leak the last message.
//   2. Optionally add a screenshot-detection heuristic based on
//      the visibility + focus state.
//
// All behaviors are opt-in via localStorage so a privacy-aware
// user can enable them without affecting everyone.
// ==========================================================

const PRIVACY_BLUR_KEY = "nexara.screenSecurity.privacyBlur";

export const screenSecurity = {

    isPrivacyBlurEnabled() {
        try {
            return (
                localStorage.getItem(PRIVACY_BLUR_KEY) ===
                "1"
            );
        } catch {
            return false;
        }
    },

    setPrivacyBlurEnabled(enabled) {
        try {
            localStorage.setItem(
                PRIVACY_BLUR_KEY,
                enabled ? "1" : "0",
            );
        } catch {
            // ignore
        }
    },

};
