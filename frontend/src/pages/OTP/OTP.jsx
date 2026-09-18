import { useLocation, useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useAuth } from "../../context/AuthContext";
import authService from "../../services/authService";

import "../Login/Login.css";
import "./OTP.css";

const RESEND_COOLDOWN = 30;

export default function OTP() {

    const navigate = useNavigate();

    const location = useLocation();

    const { login } = useAuth();

    const email =
        location.state?.email || "";

    // New-email registrations must accept Privacy + Terms before the
    // account is created; existing accounts never see the checkboxes.
    const isNew =
        location.state?.isNew === true;

    const [consentPrivacy, setConsentPrivacy] =
        useState(false);

    const [consentTerms, setConsentTerms] =
        useState(false);

    // -------------------------------------------------
    // OTP stage
    // -------------------------------------------------

    const [otp, setOtp] =
        useState("");

    const [loading, setLoading] =
        useState(false);

    const [error, setError] =
        useState("");

    // -------------------------------------------------
    // Resend cooldown (30s countdown)
    // -------------------------------------------------

    const [secondsLeft, setSecondsLeft] =
        useState(RESEND_COOLDOWN);

    const [resending, setResending] =
        useState(false);

    // -------------------------------------------------
    // Two-step verification (PIN) stage
    //
    // When the account has 2FA enabled, verify-otp answers
    // with { two_fa_required, two_fa_token, email } instead
    // of tokens. The PIN stage completes the login.
    // -------------------------------------------------

    const [pinChallenge, setPinChallenge] =
        useState(null);

    const [pin, setPin] =
        useState("");

    const [pinBusy, setPinBusy] =
        useState(false);

    // "Forgot PIN?" mode: the email OTP becomes the recovery
    // proof — resetTwoFA disables 2FA and logs the user in.
    const [forgotMode, setForgotMode] =
        useState(false);

    const [resetOtp, setResetOtp] =
        useState("");

    // -------------------------------------------------
    // Shared login helper (access token + redirect)
    // -------------------------------------------------

    async function completeLogin(accessToken) {

        await login(accessToken);

        navigate("/dashboard", {
            replace: true,
        });

    }

    // -------------------------------------------------
    // OTP Verification
    // -------------------------------------------------

    const handleVerify = async (e) => {

        e.preventDefault();

        setError("");

        if (otp.length !== 6) {

            setError(
                "OTP must be 6 digits."
            );

            return;

        }

        if (isNew && !(consentPrivacy && consentTerms)) {

            setError(
                "Please accept the Privacy Policy and Terms of Service."
            );

            return;

        }

        try {

            setLoading(true);

            const response =
                await authService.verifyOTP(
                    email,
                    otp,
                    {
                        privacy: consentPrivacy,
                        terms: consentTerms,
                    }
                );

            // -------------------------------------------------
            // 2FA challenge: move to the PIN stage
            // -------------------------------------------------

            if (response?.two_fa_required) {

                setPinChallenge({
                    twoFaToken: response.two_fa_token,
                });

                setOtp("");

                return;

            }

            // -------------------------------------------------
            // Regular login: backend returned tokens
            // -------------------------------------------------

            if (!response?.access_token) {

                const errorMsg =
                    response?.detail ||
                    response?.message ||
                    "Invalid OTP.";

                setError(errorMsg);

                toast.error(errorMsg);

                setOtp("");

                return;

            }

            await completeLogin(
                response.access_token
            );

        }

        catch (err) {

            console.error("OTP verify error:", err);

            const errorMsg =

                err.response?.data?.detail ||

                err.message ||

                "Invalid OTP.";

            setError(errorMsg);

            toast.error(errorMsg);

            setOtp("");

        }

        finally {

            setLoading(false);

        }

    };

    // -------------------------------------------------
    // PIN Verification (second factor)
    // -------------------------------------------------

    const handleVerifyPin = async (e) => {

        e.preventDefault();

        setError("");

        if (pin.length !== 6) {

            setError(
                "PIN must be 6 digits."
            );

            return;

        }

        try {

            setPinBusy(true);

            const response =
                await authService.verifyTwoFA(
                    pinChallenge.twoFaToken,
                    pin
                );

            await completeLogin(
                response.access_token
            );

        }

        catch (err) {

            console.error("PIN verify error:", err);

            const errorMsg =

                err.response?.data?.detail ||

                err.message ||

                "Incorrect PIN.";

            setError(errorMsg);

            toast.error(errorMsg);

            setPin("");

        }

        finally {

            setPinBusy(false);

        }

    };

    // -------------------------------------------------
    // Forgot PIN: resend an OTP, then reset 2FA with it
    // -------------------------------------------------

    async function handleEnterForgotMode() {

        setError("");

        setForgotMode(true);

        setSecondsLeft(RESEND_COOLDOWN);

        try {

            await authService.sendOTP(
                email
            );

            toast.success(
                "A code has been sent to your email."
            );

        }

        catch (err) {

            setError(
                err.response?.data?.detail ||
                err.message ||
                "Unable to send a code."
            );

        }

    }

    async function handleResetWithOtp(e) {

        e.preventDefault();

        setError("");

        if (resetOtp.length !== 6) {

            setError(
                "OTP must be 6 digits."
            );

            return;

        }

        try {

            setPinBusy(true);

            const response =
                await authService.resetTwoFA(
                    email,
                    resetOtp
                );

            toast.success(
                "Two-step verification turned off. " +
                "You can set a new PIN in Settings."
            );

            await completeLogin(
                response.access_token
            );

        }

        catch (err) {

            console.error("2FA reset error:", err);

            const errorMsg =

                err.response?.data?.detail ||

                err.message ||

                "Unable to reset your PIN.";

            setError(errorMsg);

            toast.error(errorMsg);

            setResetOtp("");

        }

        finally {

            setPinBusy(false);

        }

    }

    // -------------------------------------------------
    // Resend OTP (only after the cooldown ends)
    // -------------------------------------------------

    async function handleResend() {

        if (
            resending ||
            secondsLeft > 0 ||
            !email
        ) {
            return;
        }

        setResending(true);

        setError("");

        try {

            await authService.sendOTP(
                email
            );

            toast.success(
                "A new code has been sent."
            );

            if (forgotMode) {

                setResetOtp("");

            }
            else {

                setOtp("");

            }

            setSecondsLeft(
                RESEND_COOLDOWN
            );

        }

        catch (err) {

            setError(

                err.response?.data?.detail ||

                err.message ||

                "Unable to resend OTP."

            );

            toast.error(

                err.response?.data?.detail ||

                err.message ||

                "Unable to resend OTP."

            );

        }

        finally {

            setResending(false);

        }

    }

    // -------------------------------------------------
    // Resend cooldown timer
    // -------------------------------------------------

    useEffect(() => {

        if (secondsLeft <= 0) return;

        const timer =
            setTimeout(() => {

                setSecondsLeft(previous =>
                    previous - 1
                );

            }, 1000);

        return () =>
            clearTimeout(timer);

    }, [secondsLeft]);

    // =====================================================
    // PIN stage (2FA) — shown instead of the OTP form
    // =====================================================

    if (pinChallenge) {

        return (

            <div className="auth-bg">

                <div className="auth-orbs" aria-hidden="true">

                    <div className="orb orb-a" />

                    <div className="orb orb-b" />

                    <div className="orb orb-c" />

                </div>

                <div className="auth-card-wrap otp-wrap">

                    <div className="auth-card">

                        <button
                            type="button"
                            className="otp-back"
                            onClick={() => {

                                setPinChallenge(null);

                                setForgotMode(false);

                                setResetOtp("");

                                setPin("");

                            }}
                        >
                            ← Back to OTP
                        </button>

                        <h1>

                            {

                                forgotMode

                                    ? "Reset your PIN"

                                    : "Enter your PIN"

                            }

                        </h1>

                        <p className="auth-tagline">

                            {

                                forgotMode

                                    ? "Verify your email to turn "
                                      + "two-step verification off "
                                      + "for"

                                    : "Two-step verification is on "
                                      + "for"

                            }

                        </p>

                        <div className="otp-email">

                            {email || "your email"}

                        </div>

                        {!forgotMode && (

                            <form onSubmit={handleVerifyPin}>

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
                                    />

                                </div>

                                {

                                    error && (

                                        <div className="form-error">

                                            {error}

                                        </div>

                                    )

                                }

                                <button
                                    type="submit"
                                    className="btn-primary auth-submit"
                                    disabled={pinBusy}
                                >

                                    {

                                        pinBusy

                                            ? "Checking…"

                                            : "Verify & Enter"

                                    }

                                </button>

                            </form>

                        )}

                        {forgotMode && (

                            <form onSubmit={handleResetWithOtp}>

                                <div className="field otp-field">

                                    <input
                                        type="text"
                                        maxLength={6}
                                        placeholder="••••••"
                                        value={resetOtp}
                                        onChange={(e) =>
                                            setResetOtp(
                                                e.target.value.replace(/\D/g, "")
                                            )
                                        }
                                        inputMode="numeric"
                                        autoFocus
                                    />

                                </div>

                                {

                                    error && (

                                        <div className="form-error">

                                            {error}

                                        </div>

                                    )

                                }

                                <button
                                    type="submit"
                                    className="btn-primary auth-submit"
                                    disabled={pinBusy}
                                >

                                    {

                                        pinBusy

                                            ? "Resetting…"

                                            : "Verify & Turn Off 2FA"

                                    }

                                </button>

                                <p className="otp-forgot-hint">

                                    Enter the 6-digit code sent to
                                    your email. This disables
                                    two-step verification so you can
                                    log in and set a new PIN.

                                </p>

                            </form>

                        )}

                        {!forgotMode && (

                            <div className="otp-forgot">

                                <button
                                    type="button"
                                    className="btn-ghost otp-resend-btn"
                                    onClick={handleEnterForgotMode}
                                    disabled={resending}
                                >
                                    Forgot your PIN?
                                </button>

                            </div>

                        )}

                    </div>

                </div>

            </div>

        );

    }

    // =====================================================
    // OTP stage (default)
    // =====================================================

    return (

        <div className="auth-bg">

            <div className="auth-orbs" aria-hidden="true">

                <div className="orb orb-a" />

                <div className="orb orb-b" />

                <div className="orb orb-c" />

            </div>

            <div className="auth-card-wrap otp-wrap">

                <div className="auth-card">

                    <button
                        type="button"
                        className="otp-back"
                        onClick={() =>
                            navigate("/login")
                        }
                    >
                        ← Back to login
                    </button>

                    <h1>Verify OTP</h1>

                    <p className="auth-tagline">

                        Enter the 6-digit code sent to

                    </p>

                    <div className="otp-email">

                        {email || "your email"}

                    </div>

                    <form onSubmit={handleVerify}>

                        <div className="field otp-field">

                            <input
                                type="text"
                                maxLength={6}
                                placeholder="••••••"
                                value={otp}
                                onChange={(e) =>
                                    setOtp(
                                        e.target.value.replace(/\D/g, "")
                                    )
                                }
                                inputMode="numeric"
                                autoFocus
                            />

                        </div>

                        {

                            error && (

                                <div className="form-error">

                                    {error}

                                </div>

                            )

                        }

                        {isNew && (

                            <div className="otp-consent">

                                <label className="otp-consent-row">

                                    <input
                                        type="checkbox"
                                        checked={consentPrivacy}
                                        onChange={(e) =>
                                            setConsentPrivacy(
                                                e.target.checked
                                            )
                                        }
                                    />

                                    <span>

                                        I agree to the{" "}

                                        <Link to="/privacy">

                                            Privacy Policy

                                        </Link>

                                    </span>

                                </label>

                                <label className="otp-consent-row">

                                    <input
                                        type="checkbox"
                                        checked={consentTerms}
                                        onChange={(e) =>
                                            setConsentTerms(
                                                e.target.checked
                                            )
                                        }
                                    />

                                    <span>

                                        I agree to the{" "}

                                        <Link to="/terms">

                                            Terms of Service

                                        </Link>

                                    </span>

                                </label>

                            </div>

                        )}

                        <button
                            type="submit"
                            className="btn-primary auth-submit"
                            disabled={loading}
                        >

                            {

                                loading

                                    ? "Verifying..."

                                    : "Verify & Enter"

                            }

                        </button>

                    </form>

                    {/* ---------- resend (with cooldown) ---------- */}
                    <div className="otp-resend">

                        {secondsLeft > 0 ? (

                            <span className="otp-resend-timer">

                                <span
                                    className="otp-ring"
                                    style={{
                                        background:
                                            `conic-gradient(
                                                var(--accent)
                                                ${(secondsLeft / RESEND_COOLDOWN) * 360}deg,
                                                rgba(255, 255, 255, 0.08) 0deg
                                            )`,
                                    }}
                                >

                                    <span
                                        className="otp-ring-inner"
                                    >

                                        {secondsLeft}

                                    </span>

                                </span>

                                Resend code in {secondsLeft}s

                            </span>

                        ) : (

                            <button
                                type="button"
                                className="btn-ghost otp-resend-btn"
                                onClick={handleResend}
                                disabled={resending}
                            >

                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                                    <path d="M21 3v6h-6" />
                                </svg>

                                {

                                    resending

                                        ? "Sending…"

                                        : "Resend OTP"

                                }

                            </button>

                        )}

                    </div>

                </div>

            </div>

        </div>

    );

}