// Placeholder text shown when a message cannot be decrypted.
//
// These strings are compared in several places (edit/forward
// affordances, edit-replacement guards), so they are matched by
// PREFIX: a failure may append a diagnostic reason after the
// canonical prefix, and every consumer must still recognise it.
//
// ponytail: single source of truth for these prefixes. Kept as
// plain prefix strings because the diagnostic suffix is appended
// at runtime; revert to bare literals once the underlying
// decryption failure is fixed.

const UNDECRYPTABLE_PREFIX = "[Unable to decrypt]";
const LOCKED_PREFIX = "[Locked";
const OTHER_DEVICE_PREFIX = "[Sent from another device]";
const FOREIGN_DEVICE_PREFIX = "[Encrypted for another device]";

const PLACEHOLDER_PREFIXES = [
    UNDECRYPTABLE_PREFIX,
    LOCKED_PREFIX,
    OTHER_DEVICE_PREFIX,
    FOREIGN_DEVICE_PREFIX,
];

export function isDecryptPlaceholder(text) {
    return (
        typeof text === "string" &&
        PLACEHOLDER_PREFIXES.some((prefix) => text.startsWith(prefix))
    );
}

// Build a placeholder carrying the underlying failure reason, so
// the UI shows which decryption stage actually failed.
export function decryptFailure(reason) {
    const detail =
        reason instanceof Error
            ? reason.message
            : typeof reason === "string"
              ? reason
              : "";

    return detail
        ? `${UNDECRYPTABLE_PREFIX} ${detail}`
        : UNDECRYPTABLE_PREFIX;
}

export function lockedFailure(reason) {
    const detail =
        reason instanceof Error
            ? reason.message
            : typeof reason === "string"
              ? reason
              : "";

    return detail
        ? `${LOCKED_PREFIX} — go to Settings > Support > Unlock History] ${detail}`
        : `${LOCKED_PREFIX} — go to Settings > Support > Unlock History]`;
}
