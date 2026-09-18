import { describe, it, expect, beforeEach } from "vitest";
import appLock from "./appLock.js";

describe("appLock", () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    describe("isValidPin", () => {
        it("accepts 4-digit PIN", () => {
            expect(appLock.isValidPin("1234")).toBe(true);
        });

        it("accepts 6-digit PIN", () => {
            expect(appLock.isValidPin("123456")).toBe(true);
        });

        it("rejects 3-digit PIN", () => {
            expect(appLock.isValidPin("123")).toBe(false);
        });

        it("rejects 7-digit PIN", () => {
            expect(appLock.isValidPin("1234567")).toBe(false);
        });

        it("rejects non-numeric PIN", () => {
            expect(appLock.isValidPin("abcd")).toBe(false);
        });

        it("rejects mixed alphanumeric", () => {
            expect(appLock.isValidPin("12ab")).toBe(false);
        });

        it("rejects empty string", () => {
            expect(appLock.isValidPin("")).toBe(false);
        });
    });

    describe("isUnlocked / lock", () => {
        it("defaults to locked", () => {
            expect(appLock.isUnlocked()).toBe(false);
        });

        it("isConfiguredSync returns false when no HMAC stored", () => {
            expect(appLock.isConfiguredSync()).toBe(false);
        });

        it("removePin clears HMAC from localStorage", () => {
            localStorage.setItem("nexara_lock_hmac", "fake");
            appLock.removePin();
            expect(localStorage.getItem("nexara_lock_hmac")).toBeNull();
        });
    });
});
