import { useState } from "react";
import { Link } from "react-router-dom";
import "./CookieConsent.css";

const CONSENT_KEY = "nexara.cookie_consent";

export default function CookieConsent() {
    const [accepted, setAccepted] = useState(
        () => localStorage.getItem(CONSENT_KEY) !== null,
    );

    if (accepted) {
        return null;
    }

    const accept = () => {
        localStorage.setItem(
            CONSENT_KEY,
            JSON.stringify({ v: 1, at: Date.now() }),
        );
        setAccepted(true);
    };

    return (
        <aside
            className="cookie-consent"
            role="region"
            aria-label="Cookie notice"
        >
            <p className="cookie-consent-text">
                Nexara only stores a strictly-necessary authentication cookie
                and local-storage entries for your keys and preferences. No
                tracking. See our{" "}
                <Link to="/privacy">Privacy Policy</Link> and{" "}
                <Link to="/terms">Terms of Service</Link>.
            </p>
            <button
                type="button"
                className="cookie-consent-btn"
                onClick={accept}
            >
                Got it
            </button>
        </aside>
    );
}