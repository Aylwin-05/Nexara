import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";

import authService from "../../services/authService";
import {
    takeSplashRects,
} from "../../utils/splashTransition";

import "./Login.css";

function ShieldLogo() {
    return (
        <svg
            className="shield-mark auth-logo-mark"
            width="46"
            height="46"
            viewBox="0 0 32 32"
            fill="none"
        >
            <defs>
                <linearGradient
                    id="lg"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                >
                    <stop offset="0" stopColor="#7c5cff" />
                    <stop offset="1" stopColor="#22d3ee" />
                </linearGradient>
            </defs>
            <path
                d="M16 2l12 4v8c0 8-5 14-12 16C9 28 4 22 4 14V6z"
                fill="url(#lg)"
            />
            <path
                d="M12 13.5h8M12 17.5h5M12 21.5h8"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinecap="round"
            />
        </svg>
    );
}

export default function Login() {
    const navigate = useNavigate();

    const [email, setEmail] = useState("");

    const [loading, setLoading] =
        useState(false);

    const [error, setError] =
        useState("");

    const cardWrapRef = useRef(null);

    // Shared-element handover from the splash screen: the shield
    // and "Nexara" wordmark were frozen on screen at recorded
    // positions; start them there (transformed) and glide into
    // the card. Runs before paint so there is never a visible
    // jump between the two screens.
    //
    // WebView notes: the transform is committed with a forced
    // style flush instead of nested requestAnimationFrame (flaky
    // on older Androids), and reduced-motion is intentionally not
    // honoured here — Android "animation scale 0" reports it even
    // when the user wants the app's own transitions.
    useLayoutEffect(() => {
        const from = takeSplashRects();
        const wrap = cardWrapRef.current;

        if (!from || !wrap) {
            return;
        }

        const mark = wrap.querySelector(".auth-logo-mark");
        const title = wrap.querySelector(".auth-card h1");

        if (!mark || !title || !from.mark || !from.title) {
            return;
        }

        try {
            // The card's default rise-in would move our measuring
            // targets — suppress it and let FLIP drive the entrance.
            wrap.classList.add("auth-handover");

            [mark, title].forEach((el) => {
                el.style.transition = "none";
                el.style.transform = "";
            });

            const toMark = mark.getBoundingClientRect();
            const toTitle = title.getBoundingClientRect();

            const glide = (el, fromRect, toRect) => {
                const dx =
                    fromRect.left + fromRect.width / 2 -
                    (toRect.left + toRect.width / 2);
                const dy =
                    fromRect.top + fromRect.height / 2 -
                    (toRect.top + toRect.height / 2);
                const scale = fromRect.width / toRect.width;

                el.style.transformOrigin = "center center";
                el.style.transition = "none";
                el.style.transform =
                    `translate(${dx}px, ${dy}px) scale(${scale})`;
            };

            glide(mark, from.mark, toMark);
            glide(title, from.title, toTitle);

            // Commit the starting transforms synchronously…
            void document.body.offsetWidth;

            // …then release them into a transition on the next frame.
            [mark, title].forEach((el) => {
                el.style.transition =
                    "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)";
                el.style.transform = "";
            });

            setTimeout(() => {
                mark.style.transition = "";
                title.style.transition = "";
                mark.style.transformOrigin = "";
                title.style.transformOrigin = "";
            }, 700);
        } catch {
            // Handover is cosmetic — never break the login page.
        }
    }, []);

    // Focus the email field only AFTER the handover settles — an
    // immediate keyboard would resize the viewport mid-animation
    // on Android and knock the landing position off.
    useEffect(() => {
        const timer = setTimeout(() => {
            cardWrapRef.current
                ?.querySelector("input[type='email']")
                ?.focus({ preventScroll: true });
        }, 800);

        return () => clearTimeout(timer);
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();

        setError("");

        if (!email.trim()) {
            setError(
                "Please enter your email."
            );
            return;
        }

        try {
            setLoading(true);

            const response =
                await authService.sendOTP(
                    email
                );

            navigate("/otp", {
                state: {
                    email,
                    isNew: response?.is_new === true,
                },
            });
        } catch (err) {
            console.error("sendOTP error:", err);

            setError(
                err.response?.data?.detail ||
                    "Unable to send OTP." +
                        (" (" + (err.code || err.message || "") + ")")
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-bg">
            <div className="auth-orbs" aria-hidden="true">
                <div className="orb orb-a" />
                <div className="orb orb-b" />
                <div className="orb orb-c" />
            </div>

            <div className="auth-card-wrap" ref={cardWrapRef}>
                <div className="auth-card">
                    <ShieldLogo />

                    <h1>Nexara</h1>

                    <p className="auth-tagline">
                        End-to-end encrypted messaging,
                        <br />
                        protected by the Signal protocol.
                    </p>

                    <form onSubmit={handleSubmit}>
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
                                placeholder="Email Address"
                                value={email}
                                onChange={(e) =>
                                    setEmail(
                                        e.target.value
                                    )
                                }
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
                            disabled={loading}
                        >
                            {loading
                                ? "Sending..."
                                : "Continue"}
                        </button>
                    </form>

                    <div className="auth-features">
                        <span>🔐 Signal-protocol E2EE</span>
                        <span>🕊 No plaintext stored</span>
                        <span>⚡ Real-time delivery</span>
                    </div>

                    <div className="auth-legal">
                        <Link to="/privacy">Privacy</Link>
                        <span>·</span>
                        <Link to="/terms">Terms</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}