import {
    useState,
} from "react";

import { useAuth } from "../../context/AuthContext";

import "./RecoveryModal.css";

// The recovery code is stored raw (24 chars, no dashes). Display
// it in the same XXXXXX-XXXXXX-XXXXXX-XXXXXX form the recovery
// re-issue flow uses, so a code copied from either place matches
// visually. Normalization on input strips the dashes anyway.
function formatRecoveryCode(code) {
    const cleaned = String(code)
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();
    return cleaned.match(/.{1,6}/g)?.join("-") ?? cleaned;
}

// ==========================================================
// Recovery code modal (two modes)
//
// 1. "show-code": the account's recovery code was JUST created
//    by this browser's registration — display it once (it is
//    never emailed), and the sync secret is already unlocked.
//
// 2. "enter-code": this account already has a recovery key but
//    this browser hasn't unlocked the sync secret — the user
//    must type the code so old history becomes readable here.
//    Skipping is allowed (new messages still work); dismissal
//    is remembered per account, and history can be unlocked
//    later from Settings > Support.
// ==========================================================

export default function RecoveryModal({
    mode = "show-code",
    onGoToSupport = null,
}) {

    const {
        recoveryCode,
        submitRecoveryCode,
        dismissRecoveryEntry,
        dismissRecoveryCode,
    } = useAuth();

    const [code, setCode] = useState("");

    const [busy, setBusy] = useState(false);

    const [error, setError] = useState(null);

    async function handleSubmit(event) {

        event.preventDefault();

        setBusy(true);

        setError(null);

        try {

            await submitRecoveryCode(code);

            setCode("");

        }
        catch (err) {

            setError(
                err?.message ||
                "That code didn't work. Check it and try again."
            );

        }
        finally {

            setBusy(false);

        }

    }

    function handleClose() {

        if (mode === "enter-code") {

            dismissRecoveryEntry();

        }
        else {

            dismissRecoveryCode();

        }

    }

    return (

        <div className="recovery-backdrop">

            <div className="recovery-dialog">

                {mode === "show-code" ? (
                    <>
                        <div className="recovery-head">
                            <h3>Your recovery code</h3>
                        </div>

                        <p className="recovery-body">
                            This code restores your encrypted message
                            history on <strong>any new browser</strong>.
                            Keep it somewhere safe — it is shown only
                            once and never emailed.
                        </p>

                        <div className="recovery-code-box">
                            {formatRecoveryCode(recoveryCode)}
                        </div>

                        <p className="recovery-hint">
                            Your history is now syncing across your
                            browsers. Without this code, a brand-new
                            browser can only see new messages.
                        </p>

                        <div className="recovery-actions">
                            <button
                                type="button"
                                className="recovery-button primary"
                                onClick={handleClose}
                            >
                                I&apos;ve saved it
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="recovery-head">
                            <h3>Unlock your history</h3>
                        </div>

                        <p className="recovery-body">
                            This is a new browser for your account. Enter
                            your recovery code to read the full message
                            history here (including before this browser
                            was registered). New messages work either way.
                        </p>

                        {onGoToSupport && (
                            <button
                                type="button"
                                className="recovery-lost-link"
                                onClick={onGoToSupport}
                            >
                                Lost your code? Recover it here
                            </button>
                        )}

                        <form
                            className="recovery-form"
                            onSubmit={handleSubmit}
                        >
                            <input
                                type="text"
                                className="recovery-input"
                                placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                                value={code}
                                onChange={event =>
                                    setCode(
                                        event.target.value.toUpperCase()
                                    )
                                }
                                autoFocus
                                spellCheck={false}
                            />

                            {error && (
                                <p className="recovery-error">
                                    {error}
                                </p>
                            )}

                            <div className="recovery-actions">
                                <button
                                    type="button"
                                    className="recovery-button ghost"
                                    onClick={handleClose}
                                    disabled={busy}
                                >
                                    Skip for now
                                </button>

                                <button
                                    type="submit"
                                    className="recovery-button primary"
                                    disabled={busy || code.length < 20}
                                >
                                    {busy
                                        ? "Unlocking…"
                                        : "Unlock history"}
                                </button>
                            </div>
                        </form>
                    </>
                )}

            </div>

        </div>

    );

}