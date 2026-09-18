import { useState } from "react";

import ServerUrlModal from "./ServerUrlModal";

import "./ServerConfig.css";

function GearIcon() {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

// ==========================================================
// Server configuration affordance for the auth screens.
//
// The backend address is baked into native (Capacitor) builds at
// compile time via VITE_API_URL / VITE_WS_URL (see Mobile/
// dev-build.ps1). This intrusive page-level banner was removed so
// the OTP/login flow is never interrupted by a manual-entry modal.
// The gear button remains as an OPT-IN runtime repoint for power
// users — it never opens automatically.
// ==========================================================

export default function ServerConfig() {

    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                className="server-config-gear"
                aria-label="Server settings"
                title="Change the backend server address"
                onClick={() => setOpen(true)}
            >
                <GearIcon />
            </button>

            {open && (
                <ServerUrlModal
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );

}