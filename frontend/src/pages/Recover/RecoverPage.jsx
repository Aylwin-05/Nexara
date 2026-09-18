import {
    useEffect,
    useState,
} from "react";
import {
    useLocation,
    useNavigate,
} from "react-router-dom";

import toast from "react-hot-toast";

import authService from "../../services/authService";

import recoveryService from "../../services/recoveryService";

import "../Login/Login.css";
import "./RecoverPage.css";

const RESEND_COOLDOWN = 30;

// ==========================================================
// /recover — "I lost my recovery code" landing page
//
// The emailed link carries ?token=<unguessable>. The user
// enters their account email, proves it with an OTP, and the
// new recovery code is revealed. No session is required — the
// OTP is the proof (password-reset model).
// ==========================================================

export default function RecoverPage() {

    const location = useLocation();

    const navigate = useNavigate();

    const token =
        new URLSearchParams(location.search).get("token") || "";

    const [stage, setStage] = useState("email");

    const [email, setEmail] = useState("");

    const [otp, setOtp] = useState("");

    const [busy, setBusy] = useState(false);

    const [error, setError] = useState("");

    const [secondsLeft, setSecondsLeft] = useState(0);

    const [recovered, setRecovered] = useState(null);

    const [copied, setCopied] = useState(false);

    // "Already have your code?" — unlock straight from this page
    // (the session is usually still live: the emailed link opened
    // in the same tab, so no reload is needed afterwards).
    const [unlockCode, setUnlockCode] = useState("");

    const [unlockBusy, setUnlockBusy] = useState(false);

    const [unlockError, setUnlockError] = useState(null);

    // OTP resend cooldown (mirror of the login OTP page)
    useEffect(() => {

        if (secondsLeft <= 0) return;

        const timer = setTimeout(
            () => setSecondsLeft(previous => previous - 1),
            1000,
        );

        return () => clearTimeout(timer);

    }, [secondsLeft]);

    // Token must be present; otherwise the page is useless.
    useEffect(() => {

        if (!token) {

            setStage("invalid");

            setError(
                "This link is missing its recovery token. " +
                "Request a fresh link from Settings > Support."
            );

        }

    }, [token]);

    async function handleSendOtp(event) {

        event.preventDefault();

        if (busy || !email.trim()) {

            setError(
                email.trim()
                    ? ""
                    : "Enter the email for your account."
            );

            return;

        }

        setBusy(true);

        setError("");

        try {

            await authService.sendOTP(email);

            setStage("otp");

            setSecondsLeft(RESEND_COOLDOWN);

            toast.success(
                "Verification code sent — check your inbox."
            );

        }
        catch (err) {

            setError(
                err?.response?.data?.detail ||
                err?.message ||
                "Could not send the verification code."
            );

        }
        finally {

            setBusy(false);

        }

    }

    async function handleVerify(event) {

        event.preventDefault();

        if (otp.length !== 6) {

            setError("OTP must be 6 digits.");

            return;

        }

        setBusy(true);

        setError("");

        try {

            const data =
                await recoveryService.verifyRecovery({
                    token,
                    email,
                    otp,
                });

            // Unlock locally — the sync secret is now on this
            // browser, so the app no longer asks for a code.
            await recoveryService.unlockFromRegistration({
                code: data.code,
                salt: data.salt,
                wrapped_key: data.wrapped_key,
                email,
            });

            setRecovered(data);

            setStage("done");

        }
        catch (err) {

            const status = err?.response?.status;

            if (status === 404) {

                setStage("invalid");

                setError(
                    err?.response?.data?.detail ||
                    "This link is invalid or expired. Request a " +
                    "new one from Settings > Support."
                );

            }
            else if (status === 403) {

                setError(
                    "This link belongs to a different account."
                );

            }
            else {

                setError(
                    err?.response?.data?.detail ||
                    err?.message ||
                    "The verification code was wrong or expired."
                );

            }

            setOtp("");

        }
        finally {

            setBusy(false);

        }

    }

    async function handleCopy() {

        try {

            await navigator.clipboard.writeText(
                recovered?.code_display || ""
            );

            setCopied(true);

            setTimeout(() => setCopied(false), 2000);

        }
        catch {

            toast.error("Could not copy — select and copy manually.");

        }

    }

    // --------------------------------------------------
    // "Already have your code?" — unlock right here
    // --------------------------------------------------

    async function handleUnlockCode(event) {

        event.preventDefault();

        if (unlockBusy) return;

        if (unlockCode.length < 20) {

            setUnlockError(
                "Enter the full code (4 groups of 6 characters)."
            );

            return;

        }

        setUnlockBusy(true);

        setUnlockError(null);

        try {

            await recoveryService.unlock(
                unlockCode,
                email || undefined,
            );

            toast.success(
                "History unlocked on this browser."
            );

            navigate("/dashboard", {
                replace: true,
            });

        }
        catch (err) {

            if (err?.response?.status === 401) {

                setUnlockError(
                    "Sign in to your account first, then enter " +
                    "your code here."
                );

            }
            else {

                setUnlockError(
                    err?.message ||
                    "That code didn't work. Check it and try again."
                );

            }

        }
        finally {

            setUnlockBusy(false);

        }

    }

    return (
        <div className="auth-bg">
            <div className="auth-orbs" aria-hidden="true">
                <div className="orb orb-a" />
                <div className="orb orb-b" />
                <div className="orb orb-c" />
            </div>

            <div className="auth-card-wrap">
                <div className="auth-card recover-card">

                    <h1>Recover your code</h1>

                    {stage === "email" && (
                        <>
                            <p className="auth-tagline">
                                You asked to see your recovery code
                                again. We&apos;ll email a verification
                                code to prove it&apos;s you.
                            </p>

                            <form onSubmit={handleSendOtp}>
                                <div className="field">
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                    >
                                        <rect
                                            x="3"
                                            y="5"
                                            width="18"
                                            height="14"
                                            rx="3"
                                        />
                                        <path d="m3 7 9 6 9-6" />
                                    </svg>

                                    <input
                                        type="email"
                                        placeholder="Account Email"
                                        value={email}
                                        onChange={event =>
                                            setEmail(
                                                event.target.value
                                            )
                                        }
                                        autoFocus
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
                                    {busy
                                        ? "Sending…"
                                        : "Send verification code"}
                                </button>
                            </form>
                        </>
                    )}

                    {stage === "otp" && (
                        <>
                            <p className="auth-tagline">
                                Enter the 6-digit code we emailed to{" "}
                                <strong>{email}</strong>.
                            </p>

                            <form onSubmit={handleVerify}>
                                <div className="field">
                                    <input
                                        type="text"
                                        maxLength={6}
                                        placeholder="••••••"
                                        value={otp}
                                        onChange={event =>
                                            setOtp(
                                                event.target.value.replace(
                                                    /\D/g,
                                                    ""
                                                )
                                            )
                                        }
                                        inputMode="numeric"
                                        autoFocus
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
                                    {busy
                                        ? "Verifying…"
                                        : "Reveal my code"}
                                </button>
                            </form>

                            <div className="otp-resend">
                                {secondsLeft > 0 ? (
                                    <span className="otp-resend-timer">
                                        <span
                                            className="otp-ring"
                                            style={{
                                                background:
                                                    `conic-gradient(` +
                                                    `var(--accent) ` +
                                                    `${(secondsLeft / RESEND_COOLDOWN) * 360}deg, ` +
                                                    `rgba(255, 255, 255, 0.08) 0deg)`,
                                            }}
                                        >
                                            <span className="otp-ring-inner">
                                                {secondsLeft}
                                            </span>
                                        </span>
                                        Resend code in {secondsLeft}s
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        className="btn-ghost otp-resend-btn"
                                        onClick={handleSendOtp}
                                        disabled={busy}
                                    >
                                        Resend code
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    {stage === "invalid" && (
                        <p className="form-error recover-error">
                            {error}
                        </p>
                    )}

                    {stage === "done" && recovered && (
                        <>
                            <p className="auth-tagline">
                                Verified. This is your new recovery
                                code — it replaces the old one and
                                restores the same history:
                            </p>

                            <div className="recover-code-box">
                                {recovered.code_display}
                            </div>

                            <div className="recover-actions">
                                <button
                                    type="button"
                                    className="btn-ghost recover-copy"
                                    onClick={handleCopy}
                                >
                                    {copied
                                        ? "Copied!"
                                        : "Copy code"}
                                </button>

                                <button
                                    type="button"
                                    className="btn-primary auth-submit"
                                    onClick={() =>
                                        navigate("/dashboard", {
                                            replace: true,
                                        })
                                    }
                                >
                                    Go to app
                                </button>
                            </div>

                            <p className="recover-saved-hint">
                                Your history is already unlocked on this
                                browser. Save the code somewhere safe —
                                it&apos;s the only way to unlock on a
                                future browser.
                            </p>
                        </>
                    )}

                    {stage !== "done" && (
                        <div className="recovery-unlock-box">
                            <details>
                                <summary>
                                    Already have your code? Enter it here
                                </summary>

                                <form
                                    className="recovery-unlock-form"
                                    onSubmit={handleUnlockCode}
                                >
                                    <input
                                        type="text"
                                        className="recovery-unlock-input"
                                        placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                                        value={unlockCode}
                                        onChange={event =>
                                            setUnlockCode(
                                                event.target.value.toUpperCase()
                                            )
                                        }
                                        spellCheck={false}
                                        autoComplete="off"
                                    />

                                    <button
                                        type="submit"
                                        className="btn-ghost recovery-unlock-submit"
                                        disabled={unlockBusy}
                                    >
                                        {unlockBusy
                                            ? "Unlocking…"
                                            : "Unlock"}
                                    </button>
                                </form>

                                {unlockError && (
                                    <p className="form-error recovery-unlock-error">
                                        {unlockError}
                                    </p>
                                )}
                            </details>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );

}