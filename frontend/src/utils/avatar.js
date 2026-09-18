// Deterministic avatar gradients (per-user), so the same
// person always gets the same color.

const PALETTE = [
    "linear-gradient(135deg, #7c5cff, #22d3ee)",
    "linear-gradient(135deg, #f472b6, #fb923c)",
    "linear-gradient(135deg, #34d399, #22d3ee)",
    "linear-gradient(135deg, #60a5fa, #a78bfa)",
    "linear-gradient(135deg, #fbbf24, #f87171)",
    "linear-gradient(135deg, #2dd4bf, #60a5fa)",
];

function hashString(value) {
    let hash = 0;
    const seed = String(value ?? "");
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

export function avatarGradient(seed) {
    return PALETTE[hashString(seed) % PALETTE.length];
}

export function initials(name) {
    const parts = String(name ?? "?").trim().split(/\s+/);
    const first = parts[0]?.charAt(0) ?? "?";
    const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
    return (first + last).toUpperCase();
}