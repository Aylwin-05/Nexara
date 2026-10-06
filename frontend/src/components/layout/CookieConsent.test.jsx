import { beforeEach, describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CookieConsent from "./CookieConsent";

const CONSENT_KEY = "nexara.cookie_consent";

function renderConsent() {
    return render(
        <MemoryRouter>
            <CookieConsent />
        </MemoryRouter>,
    );
}

describe("CookieConsent", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("renders the notice with links to the legal pages", () => {
        renderConsent();

        expect(
            screen.getByRole("region", { name: "Cookie notice" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("link", { name: "Privacy Policy" })
                .getAttribute("href"),
        ).toBe("/privacy");
        expect(
            screen.getByRole("link", { name: "Terms of Service" })
                .getAttribute("href"),
        ).toBe("/terms");
    });

    it("persists acceptance and hides the banner", () => {
        renderConsent();

        fireEvent.click(
            screen.getByRole("button", { name: "Got it" }),
        );

        expect(JSON.parse(localStorage.getItem(CONSENT_KEY)).v).toBe(1);
        expect(
            screen.queryByRole("region", { name: "Cookie notice" }),
        ).toBeNull();
    });

    it("stays hidden once previously accepted", () => {
        localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, at: 1 }));

        renderConsent();

        expect(
            screen.queryByRole("region", { name: "Cookie notice" }),
        ).toBeNull();
    });
});