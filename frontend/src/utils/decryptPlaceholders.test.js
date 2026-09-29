import { describe, it, expect } from "vitest";
import {
    isDecryptPlaceholder,
    decryptFailure,
    lockedFailure,
} from "./decryptPlaceholders";

describe("decrypt placeholders", () => {
    it("recognises bare and diagnostic-suffixed placeholders", () => {
        expect(isDecryptPlaceholder("[Unable to decrypt]")).toBe(true);
        expect(
            isDecryptPlaceholder(
                decryptFailure("No session with sender device"),
            ),
        ).toBe(true);
        expect(
            isDecryptPlaceholder(
                lockedFailure("sync-decrypt-failed"),
            ),
        ).toBe(true);
        expect(
            isDecryptPlaceholder("[Sent from another device]"),
        ).toBe(true);
        expect(
            isDecryptPlaceholder("[Encrypted for another device]"),
        ).toBe(true);
    });

    it("does not treat real message text as a placeholder", () => {
        expect(isDecryptPlaceholder("hello there")).toBe(false);
        expect(isDecryptPlaceholder("")).toBe(false);
        expect(isDecryptPlaceholder(null)).toBe(false);
        expect(isDecryptPlaceholder(undefined)).toBe(false);
    });

    it("carries the underlying reason", () => {
        const out = decryptFailure(
            new Error("One-time prekey not found."),
        );
        expect(out).toContain("[Unable to decrypt]");
        expect(out).toContain("One-time prekey not found.");
    });

    it("still signals locked when there is no reason", () => {
        expect(isDecryptPlaceholder(lockedFailure(""))).toBe(true);
        expect(isDecryptPlaceholder(decryptFailure(""))).toBe(true);
    });
});
