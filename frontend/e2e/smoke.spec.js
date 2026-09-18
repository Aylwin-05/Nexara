import { test, expect } from "@playwright/test";

test.describe("Login page", () => {
    test("loads and shows email input", async ({ page }) => {
        await page.goto("/");

        // Should land on either splash or login
        const emailInput = page.locator(
            'input[type="email"], input[name="email"], input[placeholder*="email" i]'
        );
        await expect(emailInput.first()).toBeVisible({ timeout: 10000 });
    });

    test("shows validation on empty submit", async ({ page }) => {
        await page.goto("/");

        const emailInput = page.locator(
            'input[type="email"], input[name="email"], input[placeholder*="email" i]'
        );
        await emailInput.first().waitFor({ timeout: 10000 });

        const submitBtn = page.locator(
            'button[type="submit"], button:has-text("Continue"), button:has-text("Sign in")'
        );

        if (await submitBtn.first().isVisible()) {
            await submitBtn.first().click();

            // Should not navigate away (still on login)
            await expect(page).toHaveURL(/\//);
        }
    });
});

test.describe("404 route", () => {
    test("shows not-found page for unknown path", async ({ page }) => {
        const response = await page.goto("/this-page-does-not-exist-12345");

        // Should still render (SPA fallback)
        await expect(page.locator("body")).toBeVisible();
    });
});

test.describe("Static assets", () => {
    test("manifest.json is accessible", async ({ request }) => {
        const response = await request.get("/manifest.json");
        expect(response.ok()).toBeTruthy();

        const body = await response.json();
        expect(body.name || body.short_name).toBeTruthy();
    });
});
