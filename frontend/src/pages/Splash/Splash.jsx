import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";
import {
    saveSplashRects,
} from "../../utils/splashTransition";

import "./Splash.css";

// How long the intro stays on screen before handing over to the
// next screen, and how long the exit fade lasts.
const MIN_SPLASH_MS = 2200;
const EXIT_MS = 500;

// Failsafe: even if the auth check stalls (slow network inside
// the native shell), the intro can never trap the user. Going to
// /login is always safe — the guards redirect signed-in users
// onward to the dashboard themselves.
const HARD_CAP_MS = 6000;

function ShieldLogo() {
    return (
        <svg
            className="splash-mark"
            width="86"
            height="86"
            viewBox="0 0 32 32"
            fill="none"
        >
            <defs>
                <linearGradient
                    id="sg"
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
                fill="url(#sg)"
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

export default function Splash() {
    const navigate = useNavigate();

    const {
        loading,
        isAuthenticated,
    } = useAuth();

    const [minTimeDone, setMinTimeDone] =
        useState(false);

    const [leaving, setLeaving] =
        useState(false);

    const rootRef = useRef(null);

    // Guarantee the brand moment even when auth resolves fast.
    useEffect(() => {
        const timer = setTimeout(
            () => setMinTimeDone(true),
            MIN_SPLASH_MS
        );
        return () => clearTimeout(timer);
    }, []);

    // Hard cap: leave no matter what once this fires.
    useEffect(() => {
        const timer = setTimeout(
            () => setLeaving(true),
            HARD_CAP_MS
        );
        return () => clearTimeout(timer);
    }, []);

    // Leave once auth resolved AND the minimum time elapsed,
    // so the handover lands on the right first screen.
    useEffect(() => {
        if (loading || !minTimeDone || leaving) {
            return;
        }

        setLeaving(true);
    }, [loading, minTimeDone, leaving]);

    // The backdrop dissolves while the wordmark and shield hold
    // perfectly still; right before the route swap their on-screen
    // rectangles are recorded so Login can FLIP-glide them from
    // these exact spots into the card. Kept in a separate effect:
    // nothing here changes state mid-flight, so the timer can't
    // be cancelled by a re-render.
    useEffect(() => {
        if (!leaving) {
            return;
        }

        const timer = setTimeout(() => {
            const pick = (selector) => {
                const el = rootRef.current?.querySelector(selector);
                if (!el) {
                    return null;
                }
                const r = el.getBoundingClientRect();
                return {
                    left: r.left,
                    top: r.top,
                    width: r.width,
                    height: r.height,
                };
            };

            saveSplashRects({
                mark: pick(".splash-mark"),
                title: pick(".splash-title"),
            });

            navigate(
                isAuthenticated ? "/dashboard" : "/login",
                { replace: true }
            );
        }, EXIT_MS);

        return () => clearTimeout(timer);
    }, [leaving, isAuthenticated, navigate]);

    return (
        <div
            ref={rootRef}
            className={`splash${leaving ? " splash-leave" : ""}`}
            aria-hidden={leaving}
        >
            <div className="auth-orbs">
                <span className="orb orb-a" />
                <span className="orb orb-b" />
                <span className="orb orb-c" />
            </div>

            <div className="splash-content">
                <ShieldLogo />

                <h1 className="splash-title">Nexara</h1>

                <p className="splash-tagline">
                    Where privacy connects people
                </p>
            </div>

            <div className="splash-loader" aria-hidden="true">
                <span />
                <span />
                <span />
            </div>
        </div>
    );
}
