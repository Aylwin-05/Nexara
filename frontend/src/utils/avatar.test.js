import { describe, it, expect } from "vitest";
import { avatarGradient, initials } from "./avatar.js";

describe("avatarGradient", () => {
    it("returns a linear-gradient string", () => {
        const g = avatarGradient("alice");
        expect(g).toMatch(/^linear-gradient/);
    });

    it("is deterministic for the same seed", () => {
        expect(avatarGradient("bob")).toBe(avatarGradient("bob"));
    });

    it("produces different gradients for different seeds", () => {
        const seen = new Set();
        for (const name of ["alice", "bob", "carol", "dave", "eve", "frank"]) {
            seen.add(avatarGradient(name));
        }
        expect(seen.size).toBeGreaterThan(1);
    });

    it("handles null/undefined gracefully", () => {
        expect(avatarGradient(null)).toMatch(/^linear-gradient/);
        expect(avatarGradient(undefined)).toMatch(/^linear-gradient/);
    });
});

describe("initials", () => {
    it("returns first letter of single name", () => {
        expect(initials("Alice")).toBe("A");
    });

    it("returns first + last for full name", () => {
        expect(initials("Alice Smith")).toBe("AS");
    });

    it("handles three-part names", () => {
        expect(initials("Alice B Smith")).toBe("AS");
    });

    it("returns ? for empty input", () => {
        expect(initials("")).toBe("");
    });

    it("returns ? for null", () => {
        expect(initials(null)).toBe("?");
    });

    it("trims whitespace", () => {
        expect(initials("  Alice  Smith  ")).toBe("AS");
    });
});
