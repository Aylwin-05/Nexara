import { useState } from "react";

import { getConfiguredServer } from "../../api/api";
import { useModalAnimation } from "../../hooks/useModalAnimation";

import "./ServerUrlModal.css";

// ==========================================================
// Server address configuration for native (Capacitor) builds.
//
// A plain web build keeps every API call relative to its own
// origin, so it never needs this. A native shell, however, loads
// from https://localhost — a build that ships without a baked
// server URL would silently talk to its own asset server and
// fail (the classic "can't send OTP on the phone"). This modal
// lets the user point the app at the backend at runtime; the
// value is persisted to "nexara.server_url", which api.js and
// websocketService.js already honour on every (re)load/connect.
// ==========================================================

const SERVER_URL_KEY = "nexara.server_url";

function normalizeServer(value) {

    const trimmed = value.trim().replace(/\/+$/, "");

    if (!trimmed) return "";

    return /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `http://${trimmed}`;

}

function validateServer(value) {

    if (/\s/.test(value)) {

        return "No spaces allowed.";

    }

    if (
        value.includes("://") &&
        !/^https?:\/\//i.test(value)
    ) {

        return "Use an http:// or https:// address.";

    }

    return "";

}

export default function ServerUrlModal({ onClose }) {

    const [value, setValue] = useState(
        getConfiguredServer()
    );

    const [error, setError] = useState("");

    const { contentRef } = useModalAnimation();

    function handleSave(event) {

        event.preventDefault();

        const validationError =
            validateServer(value);

        if (validationError) {

            setError(validationError);

            return;

        }

        const normalized =
            normalizeServer(value);

        if (normalized) {

            localStorage.setItem(
                SERVER_URL_KEY,
                normalized
            );

        }
        else {

            localStorage.removeItem(
                SERVER_URL_KEY
            );

        }

        // SERVER_URL in api.js is resolved at module load, so the
        // app restarts to pick up the new address cleanly.
        window.location.reload();

    }

    function handleReset() {

        localStorage.removeItem(SERVER_URL_KEY);

        window.location.reload();

    }

    return (

        <div
            className="modal-overlay"
            onClick={onClose}
        >

            <div
                ref={contentRef}
                className="modal-card server-url-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Server settings"
                onClick={(event) =>
                    event.stopPropagation()
                }
            >

                <h3>Server address</h3>

                <p className="server-url-hint">

                    Where should this app reach the Nexara
                    backend? Phone builds need the machine's
                    LAN IP — e.g.{" "}
                    <code>http://192.168.1.20:8000</code>{" "}
                    — while remote installs use the domain,{" "}
                    <code>https://chat.example.com</code>.
                    Messaging, WebSocket and OTP all use it.

                </p>

                <form onSubmit={handleSave}>

                    <div className="field server-url-field">

                        <input
                            type="text"
                            inputMode="url"
                            autoComplete="off"
                            autoCapitalize="off"
                            spellCheck="false"
                            placeholder="http://192.168.1.20:8000"
                            value={value}
                            onChange={(e) => {
                                setValue(e.target.value);
                                setError("");
                            }}
                            autoFocus
                        />

                    </div>

                    {error && (
                        <div className="form-error">
                            {error}
                        </div>
                    )}

                    <div className="server-url-actions">

                        <button
                            type="button"
                            className="btn-ghost"
                            onClick={handleReset}
                        >
                            Reset to default
                        </button>

                        <button
                            type="button"
                            className="btn-ghost"
                            onClick={onClose}
                        >
                            Cancel
                        </button>

                        <button
                            type="submit"
                            className="btn-primary"
                            disabled={!value.trim()}
                        >
                            Save &amp; Reload
                        </button>

                    </div>

                </form>

            </div>

        </div>

    );

}