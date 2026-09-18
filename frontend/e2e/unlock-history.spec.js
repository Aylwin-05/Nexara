import { test, expect } from "@playwright/test";
import fs from "node:fs";

// =============================================================
// Cross-browser history unlock regression: a second browser of an
// account sees locked history, unlocks via Settings > Support with
// the recovery code, and the chats must become readable again.
// Requires the same local backend + vite dev servers as the
// walkthrough spec.
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

function log(text) {
    console.log("[unlock-history]", text);
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

    // New accounts must accept the Privacy Policy + Terms before the
    // account is created; the consent block renders a moment after the
    // OTP field; existing accounts render no checkboxes.
    const consent = page.locator(".otp-consent input[type=checkbox]");
    await consent.first().waitFor({ state: "visible", timeout: 5000 })
        .catch(() => {});
    if ((await consent.count()) > 0) {
        await consent.nth(0).check();
        await consent.nth(1).check();
    }

    await page.getByRole("textbox").fill(otp);
    await page.getByRole("button", { name: "Verify & Enter" }).click();
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    return page.getByRole("heading", { name: /^Chats$/, level: 2 })
        .waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
}

async function captureRecoveryCode(page) {
    await page.locator(".recovery-backdrop").waitFor({ state: "visible", timeout: 10_000 });
    const code = (await page.locator(".recovery-code-box").textContent()).trim();
    await page.getByRole("button", { name: "I've saved it" }).click();
    await page.locator(".recovery-backdrop").waitFor({ state: "hidden" });
    return code;
}

async function dismissRecoveryIfPresent(page) {
    for (let i = 0; i < 8; i += 1) {
        if (await page.locator(".recovery-backdrop").isVisible().catch(() => false)) {
            const skip = page.getByRole("button", { name: "Skip for now" });
            const saved = page.getByRole("button", { name: "I've saved it" });
            if (await skip.isVisible().catch(() => false)) {
                await skip.click();
            } else if (await saved.isVisible().catch(() => false)) {
                await saved.click();
            }
            await page.locator(".recovery-backdrop").waitFor({ state: "hidden" })
                .catch(() => {});
        }
        await page.waitForTimeout(500);
    }
}

// In-page API helper. The access token is memory-only in the app,
// so grab a fresh one via /auth/refresh (HttpOnly cookie attaches
// automatically) and send it as a bearer header. Tokens are cached
// per page and only refreshed when a call 401s: the app and the
// helper both use /auth/refresh, whose rotation invalidates the
// other side's copy if they fire at the same moment.
const tokenCache = new Map();

async function refreshToken(page) {
    const { status, data } = await page.evaluate(async () => {
        const res = await fetch("/api/v1/auth/refresh", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
    });
    return { status, data };
}

async function bearerToken(page) {
    if (tokenCache.has(page)) return tokenCache.get(page);
    const { data } = await refreshToken(page);
    if (data.access_token) tokenCache.set(page, data.access_token);
    return data.access_token;
}

async function api(page, path, { method = "GET", body = null } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = await bearerToken(page);
        const res = await page.evaluate(
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
        // 401 for a cached token: a rotate raced us. Drop it and retry.
        if (res.status === 401 && tokenCache.has(page)) {
            tokenCache.delete(page);
            continue;
        }
        return res;
    }
}

test("second device of an account unlocks history from Settings", async ({ browser }) => {
    test.setTimeout(240_000);
    test.skip(!(await backendUp()), "local backend not running");
    log("start");

    const stamp = Date.now();
    const emailA = `reproa.${stamp}@example.com`;
    const emailB = `reprob.${stamp}@example.com`;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const pageC = await ctxC.newPage();

    await pageA.goto("/");
    await pageA.getByPlaceholder("Email Address").fill(emailA);
    await pageA.getByRole("button", { name: "Continue" }).click();
    await pageA.waitForURL("**/otp");

    // First-ever login for A mints the recovery code.
    await uiLogin(pageA, emailA);
    const recoveryCode = await captureRecoveryCode(pageA);
    log("A recovery code: " + recoveryCode);

    await uiLogin(pageB, emailB);
    log("B logged in");
    await dismissRecoveryIfPresent(pageB);

    // friend + private conversation
    const meA = (await api(pageA, "/api/v1/users/me")).data;
    const meB = (await api(pageB, "/api/v1/users/me")).data;
    await api(pageA, "/api/v1/friends/request", {
        method: "POST",
        body: { receiver_id: meB.id },
    });
    const pending = (await api(pageB, "/api/v1/friends/pending")).data;
    const friendship = pending.find((f) => f.sender?.id === meA.id || f.sender_id === meA.id);
    expect(friendship).toBeTruthy();
    await api(pageB, "/api/v1/friends/accept", {
        method: "POST",
        body: { friendship_id: friendship.id },
    });
    await api(pageA, "/api/v1/conversations/private", {
        method: "POST",
        body: { user_id: meB.id },
    });

    await pageA.reload();
    await dismissRecoveryIfPresent(pageA);
    await pageB.reload();
    await dismissRecoveryIfPresent(pageB);
    log("friends + conversation seeded");

    for (const page of [pageA, pageB]) {
        const item = page.locator(".conv-item").first();
        await item.waitFor({ state: "visible", timeout: 15_000 });
        await item.click();
        await page.locator(".chat-input-field").waitFor({ state: "visible", timeout: 15_000 });
    }
    log("both opened the conversation");

    // B sends a message -> sync copy on A + B.
    await pageB.locator(".chat-input-field").fill("sync-history-probe");
    await pageB.locator(".chat-input-field").press("Enter");
    await pageB.getByText("sync-history-probe").waitFor({ timeout: 20_000 });
    await pageA.getByText("sync-history-probe").waitFor({ timeout: 20_000 });
    log("message sent and visible on A + B");

    // Now the second device of account A logs in (no sync secret).
    await uiLogin(pageC, emailA);
    await dismissRecoveryIfPresent(pageC);
    log("C logged in as A");

    await pageC.locator(".conv-item").first().click();
    await pageC.locator(".chat-input-field").waitFor({ state: "visible", timeout: 15_000 });

    // Wait a beat for decryption, then check what C shows for the message.
    await pageC.waitForTimeout(3000);
    const locked = await pageC.getByText(
        "[Locked — go to Settings > Support > Unlock History]"
    ).count();
    const readable = await pageC.getByText("sync-history-probe").count();
    log(`before unlock: locked=${locked} readable=${readable}`);

    // Unlock via Settings > Support.
    await pageC.locator('button[title="Settings"]').click();
    await pageC.getByRole("heading", { name: "Settings", exact: true, level: 2 })
        .waitFor({ timeout: 10_000 });
    await pageC.locator(".recovery-unlock-box summary").click();
    const input = pageC.locator(".recovery-unlock-input");
    await input.fill(recoveryCode);
    await pageC.locator(".recovery-unlock-form button[type=submit]").click();

    // Wait for successful toast.
    const toast = pageC.getByText("History unlocked on this browser.");
    await toast.waitFor({ timeout: 15_000 });
    log("unlock toast seen");

    // Back to chats, reopen the conversation, expect readable text.
    await pageC.locator('button[title="Chats"]').click();
    const convItem = pageC.locator(".conv-item").first();
    await convItem.waitFor({ state: "visible", timeout: 15_000 });
    await convItem.click();
    await pageC.locator(".chat-input-field").waitFor({ state: "visible", timeout: 15_000 });
    await pageC.waitForTimeout(3000);

    const lockedAfter = await pageC.getByText(
        "[Locked — go to Settings > Support > Unlock History]"
    ).count();
    const readableAfter = await pageC.getByText("sync-history-probe").count();
    log(`after unlock: locked=${lockedAfter} readable=${readableAfter}`);

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();

    expect(readableAfter, "history should be readable after unlock").toBeGreaterThan(0);
    expect(lockedAfter).toBe(0);
});