import { test, expect } from "@playwright/test";
import fs from "node:fs";

// =============================================================
// Full logged-in walkthrough: two real browser sessions, real
// Signal E2EE between two auto-registered devices, realtime
// (websocket) delivery, and a click-through of the chat actions.
//
// Requires the backend running locally (dev mode, DEBUG=true so
// the OTP is printed to the server console instead of emailed)
// with `vite` dev server proxying /api and /ws.
//
// Backend console log path: set BACKEND_LOG, or it falls back to
// the temp path used in local dev sessions.
// =============================================================

const BACKEND_LOG =
    process.env.BACKEND_LOG ||
    "C:\\Users\\dell\\AppData\\Local\\Temp\\opencode\\uvicorn2.out";
const API = "http://127.0.0.1:8000";

async function backendUp() {
    try {
        const res = await fetch(`${API}/health`);
        return res.ok;
    } catch {
        return false;
    }
}

function readLog() {
    return fs
        .readFileSync(BACKEND_LOG, "utf8")
        .replace(/\x1b\[[0-9;]*m/g, "");
}

async function waitForFreshOtp(page, email) {
    const re = new RegExp(`OTP for ${email}: (\\d+)`, "g");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const matches = [...readLog().matchAll(re)];
        if (matches.length > 0) {
            return matches[matches.length - 1][1];
        }
        await page.waitForTimeout(400);
    }
    throw new Error(`no fresh OTP found for ${email} in backend log`);
}

async function uiLogin(page, email) {
    await page.goto("/");
    await page.getByPlaceholder("Email Address").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/otp");

    const otp = await waitForFreshOtp(page, email);
    await page.getByRole("textbox").fill(otp);
    await page.getByRole("button", { name: "Verify & Enter" }).click();
    await page.waitForURL("**/dashboard", { timeout: 20_000 });

    // New accounts are asked to save their recovery code.
    if (await page.locator(".recovery-backdrop").isVisible().catch(() => false)) {
        await page.getByRole("button", { name: "I've saved it" }).click();
    }
}

async function dismissRecoveryIfPresent(page) {
    if (await page.locator(".recovery-backdrop").isVisible().catch(() => false)) {
        await page.getByRole("button", { name: "I've saved it" }).click().catch(() => {});
        await page.locator(".recovery-backdrop").waitFor({ state: "hidden" }).catch(() => {});
    }
}

// In-page API helper. The access token is memory-only in the app,
// so grab a fresh one via /auth/refresh (HttpOnly cookie attaches
// automatically) and send it as a bearer header.
async function bearerToken(page) {
    return page.evaluate(async () => {
        const res = await fetch("/api/v1/auth/refresh", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
        });
        const data = await res.json().catch(() => ({}));
        return data.access_token;
    });
}

async function api(page, path, { method = "GET", body = null } = {}) {
    const token = await bearerToken(page);
    return page.evaluate(
        async ({ path, method, body, token }) => {
            const res = await fetch(path, {
                method,
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: body ? JSON.stringify(body) : undefined,
            });
            const text = await res.text();
            let data = null;
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch {
                    data = text;
                }
            }
            return { status: res.status, data };
        },
        { path, method, body, token },
    );
}

test("logged-in walkthrough: E2EE send, realtime receive, star, react, edit, search, disappearing, tabs", async ({
    browser,
}) => {
    test.setTimeout(240_000);
    test.skip(!(await backendUp()), "local backend not running — walkthrough skipped");

    const stamp = Date.now();
    const emailA = `walka.${stamp}@example.com`;
    const emailB = `walkb.${stamp}@example.com`;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const problems = [];
    for (const [name, page] of [["A", pageA], ["B", pageB]]) {
        page.on("pageerror", (err) => problems.push(`${name} pageerror: ${err.message}`));
        page.on("requestfailed", (req) =>
            problems.push(`${name} requestfailed: ${req.method()} ${req.url()}`));
        page.on("response", (res) => {
            const url = res.url();
            if (res.status() >= 400 && !url.includes("/favicon")) {
                // Auth refresh 401 is the designed response of the
                // refresh-token rotation guard, not an app bug.
                if (res.status() === 401 && url.includes("/auth/refresh")) return;
                problems.push(`${name} HTTP ${res.status()} ${res.request().method()} ${url}`);
            }
        });
    }

    // ---- two real UI logins (each registers a real Signal device) ----
    await uiLogin(pageA, emailA);
    await uiLogin(pageB, emailB);

    // ---- seed friendship + private conversation via in-page APIs ----
    const meA = (await api(pageA, "/api/v1/users/me")).data;
    const meB = (await api(pageB, "/api/v1/users/me")).data;

    const req = await api(pageA, "/api/v1/friends/request", {
        method: "POST",
        body: { receiver_id: meB.id },
    });
    expect(req.status).toBe(200);

    const pending = await api(pageB, "/api/v1/friends/pending");
    expect(pending.status).toBe(200);
    const friendship = pending.data.find((f) => f.sender?.id === meA.id || f.sender_id === meA.id);
    expect(friendship).toBeTruthy();

    const acc = await api(pageB, "/api/v1/friends/accept", {
        method: "POST",
        body: { friendship_id: friendship.id },
    });
    expect(acc.status).toBe(200);

    const conv = await api(pageA, "/api/v1/conversations/private", {
        method: "POST",
        body: { user_id: meB.id },
    });
    expect(conv.status).toBe(200);

    // ---- both pages reload so the new conversation appears ----
    await pageA.reload();
    await dismissRecoveryIfPresent(pageA);
    await pageB.reload();
    await dismissRecoveryIfPresent(pageB);

    for (const page of [pageA, pageB]) {
        const item = page.locator(".conv-item").first();
        await item.waitFor({ state: "visible", timeout: 15_000 });
        await item.click();
        await page.locator(".chat-input-field").waitFor({ state: "visible", timeout: 15_000 });
    }

    console.log("[walk] B sends E2EE");
    // ---- B sends a real E2EE message (full Signal X3DH path) ----
    await pageB.locator(".chat-input-field").fill("nexara-ratchet-live");
    await pageB.locator(".chat-input-field").press("Enter");
    await pageB.getByText("nexara-ratchet-live").waitFor({ timeout: 20_000 });

    // ---- A receives it over the websocket, no reload ----
    await pageA.getByText("nexara-ratchet-live").waitFor({ timeout: 20_000 });

    console.log("[walk] star");
    // ---- A stars it and opens the starred modal ----
    await pageA.getByText("nexara-ratchet-live").hover();
    await pageA.locator('button[aria-label="Message actions"]').last().click();
    await pageA.locator(".bubble-menu-item", { hasText: "Star" }).click();
    await pageA.locator('[title="Starred messages"]').first().click();
    await pageA.getByText("nexara-ratchet-live").last().waitFor({ timeout: 10_000 });
    await pageA.locator(".modal-overlay button[aria-label=\"Close\"]")
        .first().click();

    console.log("[walk] react");
    // ---- A reacts with a heart ----
    await pageA.getByText("nexara-ratchet-live").hover();
    await pageA.locator('button[aria-label="Message actions"]').last().click();
    await pageA.locator('button[aria-label="React ❤️"]').click();
    await pageA.locator(".reaction-chip").first().waitFor({ timeout: 10_000 });

    console.log("[walk] edit");
    // ---- B edits its own message ----
    await pageB.getByText("nexara-ratchet-live").hover();
    await pageB.locator('button[aria-label="Message actions"]').last().click();
    await pageB.locator(".bubble-menu-item", { hasText: "Edit" }).click();
    await pageB.getByPlaceholder("Edit message...").fill("nexara-ratchet-edited");
    await pageB.getByRole("button", { name: "Save edited message" }).click();
    await pageB.getByText("nexara-ratchet-edited").waitFor({ timeout: 15_000 });

    // ---- A sees the edit arrive over the websocket ----
    await pageA.getByText("nexara-ratchet-edited").waitFor({ timeout: 15_000 });

    console.log("[walk] search");
    // ---- A searches messages (client-side over decrypted history) ----
    await pageA.locator('[title="Search messages"]').last().click();
    await pageA.locator(".chat-search-input").fill("ratchet");
    await pageA.locator(".chat-search-count").waitFor({ timeout: 10_000 });
    await expect(pageA.locator(".chat-search-count")).toHaveText(/1 of \d+/);
    await pageA.keyboard.press("Escape");

    console.log("[walk] disappearing");
    // ---- disappearing messages: on, then off ----
    await pageA.locator('[title="Disappearing messages"]').last().click();
    await pageA.locator(".timer-option", { hasText: "24 hours" }).click();
    await pageA.getByText(/Disappearing messages on/i).waitFor({ timeout: 10_000 });
    await pageA.locator('[title="Disappearing messages on"]').last().click();
    await pageA.locator(".timer-option", { hasText: "Off" }).click();

    console.log("[walk] tabs");
    // ---- sidebar tabs render ----
    const tabs = [
        ["Status", /^Status$/],
        ["Friends", /^Friends$/],
        ["Calls", /^Call History$/],
        ["Settings", /^Settings$/],
    ];
    for (const [title, heading] of tabs) {
        await pageA.locator(`button[title="${title}"]`).click();
        await pageA
            .getByRole("heading", { name: heading, exact: true, level: 2 })
            .waitFor({ timeout: 10_000 });
    }
    await pageA.locator('button[title="Chats"]').click();
    await pageA.locator(".conv-item").first().waitFor({ state: "visible", timeout: 10_000 });

    await ctxA.close();
    await ctxB.close();

    expect(problems, problems.join("\n")).toEqual([]);
});