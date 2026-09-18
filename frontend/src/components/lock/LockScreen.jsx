import { useState } from "react";

import appLock from "../../utils/appLock";

import "./LockScreen.css";

export default function LockScreen({ onUnlocked }) {

    const [pin, setPin] = useState("");

    const [error, setError] = useState("");

    const [busy, setBusy] = useState(false);

    const [forgotMode, setForgotMode] = useState(false);

    async function handleSubmit(e) {

        e.preventDefault();

        if (busy) return;

        setError("");

        if (pin.length < 4) {

            setError(
                "Enter your PIN to unlock."
            );

            return;

        }

        setBusy(true);

        try {

            const result = await appLock.verify(pin);

            if (result.valid) {

                setPin("");

                onUnlocked();

            }
            else if (result.notConfigured) {

                //--------------------------------------------------
                // No PIN actually configured: never trap the user.
                //--------------------------------------------------

                onUnlocked();

            }
            else if (result.retryDelayMs) {

                const minutes =
                    Math.ceil(result.retryDelayMs / 60000);

                setError(

                    minutes > 1

                        ? `Too many attempts. Try again in ${minutes} minutes.`

                        : "Too many attempts. Try again in a minute."

                );

                setPin("");

            }
            else if (result.attemptsLeft) {

                setError(

                    `Incorrect PIN. ${result.attemptsLeft} ` +

                    (result.attemptsLeft === 1
                        ? "attempt"
                        : "attempts") +
                    " left before lockout."

                );

                setPin("");

            }
            else {

                setError(
                    "Incorrect PIN. Try again."
                );

                setPin("");

            }

        }
        catch {

            setError(
                "Something went wrong. Please try again."
            );

        }
        finally {

            setBusy(false);

        }

    }

    async function handleReset() {

        if (busy) return;

        setBusy(true);

        try {

            await appLock.resetPin();

            onUnlocked();

        }
        catch {

            setError(
                "Could not reset the PIN. Please try again."
            );

        }
        finally {

            setBusy(false);

        }

    }

    return (

        <div className="lock-screen">

            <div className="lock-card">

                <div className="lock-icon" aria-hidden="true">

                    <svg
                        width="34"
                        height="34"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>

                </div>

                <h1>Locked</h1>

                <p className="lock-hint">

                    Nexara is locked on this device.
                    Enter your PIN to continue.

                </p>

                {!forgotMode && (

                    <form onSubmit={handleSubmit}>

                        <div className="field otp-field">

                            <input
                                type="password"
                                maxLength={6}
                                placeholder="••••••"
                                value={pin}
                                onChange={(e) =>
                                    setPin(
                                        e.target.value.replace(/\D/g, "")
                                    )
                                }
                                inputMode="numeric"
                                autoFocus
                                autoComplete="off"
                            />

                        </div>

                        {error && (

                            <div className="form-error">

                                {error}

                            </div>

                        )}

                        <button
                            type="submit"
                            className="btn-primary auth-submit"
                            disabled={busy}
                        >

                            {

                                busy

                                    ? "Unlocking…"

                                    : "Unlock"

                            }

                        </button>

                    </form>

                )}

                {forgotMode && (

                    <div className="lock-reset-box" role="alertdialog">

                        <p>

                            Resetting removes app lock from this
                            device so you can get back in. Anyone
                            with access to this browser could do
                            the same — you can set a new PIN right
                            after in{" "}
                            <strong>Settings → App lock</strong>.

                        </p>

                        <div className="lock-reset-actions">

                            <button
                                type="button"
                                className="btn-ghost btn-sm-lock"
                                onClick={() => {
                                    setForgotMode(false);
                                    setError("");
                                }}
                                disabled={busy}
                            >
                                Back
                            </button>

                            <button
                                type="button"
                                className="btn-danger btn-sm-lock"
                                onClick={handleReset}
                                disabled={busy}
                            >
                                {busy ? "Resetting…" : "Reset PIN"}
                            </button>

                        </div>

                    </div>

                )}

                {!forgotMode && (

                    <button
                        type="button"
                        className="lock-forgot"
                        onClick={() => {
                            setForgotMode(true);
                            setError("");
                        }}
                    >
                        Forgot PIN?
                    </button>

                )}

                <p className="lock-note">

                    Your PIN never leaves this device.

                </p>

            </div>

        </div>

    );

}
