// ==========================================================
// Account Sync Crypto (cross-browser history)
//
// Every account has ONE 32-byte "sync secret". Any device that
// decrypts a message (or file) re-encrypts the plaintext with
// this secret and stores the blob server-side (sync_envelope /
// sync_blob). Browsers that register later — and therefore have
// no per-device envelope for old messages — read the history
// through these copies after unlocking the secret.
//
// The secret itself is never stored server-side: it is wrapped
// with a key derived from the one-time recovery code (PBKDF2 +
// AES-GCM). A stolen database yields only the wrapped blob.
//
// Uses @noble/hashes + @noble/ciphers (same as the Signal
// layer) so this module is unit-testable in Node.
// ==========================================================

import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

import { randomBytes, b64encode, b64decode, utf8Encode, utf8Decode } from "./signal/bytes.js";
import { signalKeyStore } from "./signal/keyStore.js";

export const SYNC_KEY_ITERATIONS = 600_000;
export const SYNC_KEY_SIZE = 32;
export const SYNC_NONCE_SIZE = 12;

let cachedSyncKey = null;

// The backend stores and serves the PBKDF2 salt as HEX
// (recovery_service.py: salt.hex()). Earlier client code tried
// base64 — which silently produced wrong salt bytes and made
// every unlock fail the AES-GCM tag check. Accept hex first,
// fall back to base64 for safety.
function decodeSalt(text) {
    const value = String(text).trim();

    if (value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value)) {
        const bytes = new Uint8Array(value.length / 2);
        for (let i = 0; i < bytes.length; i += 1) {
            bytes[i] = parseInt(value.substr(i * 2, 2), 16);
        }
        return bytes;
    }

    return b64decode(value);
}

// ==========================================================
// Recovery code -> wrap key -> sync secret
// ==========================================================

export function normalizeRecoveryCode(code) {
    return String(code).replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function deriveWrapKeyFromCode(code, saltText) {
    const salt = decodeSalt(saltText);
    return pbkdf2(
        sha256,
        utf8Encode(normalizeRecoveryCode(code)),
        salt,
        {
            c: SYNC_KEY_ITERATIONS,
            dkLen: SYNC_KEY_SIZE,
        },
    );
}

export function unwrapSyncSecret(code, saltB64, wrappedKey) {
    try {
        const key = deriveWrapKeyFromCode(code, saltB64);
        const nonce = b64decode(wrappedKey.nonce);
        const data = b64decode(wrappedKey.data);
        const plain = gcm(key, nonce).decrypt(data);
        if (plain.length !== SYNC_KEY_SIZE) return null;
        return b64encode(plain);
    }
    catch {
        return null;
    }
}

// ==========================================================
// Sync-key access (stored secret -> AES-256-GCM key)
// ==========================================================

export async function getSyncKey() {
    if (cachedSyncKey) return cachedSyncKey;
    const secretB64 = await signalKeyStore.getSyncSecret();
    if (!secretB64) return null;
    cachedSyncKey = b64decode(secretB64);
    return cachedSyncKey;
}

export function clearSyncKeyCache() {
    cachedSyncKey = null;
}

// ==========================================================
// Sync copies (messages: text; attachments: bytes)
// ==========================================================

export async function encryptSyncText(plaintext, ciphertext = null) {
    const key = await getSyncKey();
    if (!key) return null;
    const nonce = randomBytes(SYNC_NONCE_SIZE);
    const data = gcm(key, nonce).encrypt(utf8Encode(plaintext));
    return {
        nonce: b64encode(nonce),
        data: b64encode(data),
        ciphertext,
    };
}

export async function decryptSyncText(envelope) {
    const key = await getSyncKey();
    if (!key || !envelope?.nonce || !envelope?.data) {
        return null;
    }
    try {
        return utf8Decode(
            gcm(key, b64decode(envelope.nonce)).decrypt(
                b64decode(envelope.data),
            ),
        );
    }
    catch (error) {
        return null;
    }
}

export async function encryptSyncBytes(bytes) {
    const key = await getSyncKey();
    if (!key) return null;
    const nonce = randomBytes(SYNC_NONCE_SIZE);
    const data = gcm(key, nonce).encrypt(bytes);
    return {
        nonce: b64encode(nonce),
        data: b64encode(data),
    };
}

export async function decryptSyncBytes(envelope) {
    const key = await getSyncKey();
    if (!key || !envelope?.nonce || !envelope?.data) return null;
    try {
        return gcm(key, b64decode(envelope.nonce)).decrypt(
            b64decode(envelope.data),
        );
    }
    catch {
        return null;
    }
}