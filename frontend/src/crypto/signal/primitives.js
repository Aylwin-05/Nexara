// ==========================================================
// Nexara Signal Protocol Primitives
//
// JS mirror of backend/app/crypto/signal/primitives.py.
//
// Uses @noble/curves (X25519/Ed25519) + @noble/hashes (HKDF/HMAC)
// + @noble/ciphers (AES-256-GCM). All keys are raw 32-byte
// Uint8Array values; base64 happens at the API boundary.
// ==========================================================

import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf as nobleHkdf } from "@noble/hashes/hkdf.js";
import { gcm } from "@noble/ciphers/aes.js";

import { randomBytes } from "./bytes.js";

// ==========================================================
// Constants (must match backend)
// ==========================================================

export const CURVE25519_KEY_SIZE = 32;
export const ED25519_KEY_SIZE = 32;
export const AES_KEY_SIZE = 32;
export const AES_NONCE_SIZE = 12;

export const HKDF_INFO_MESSAGE_KEYS = utf8Bytes("WhisperMessageKeys");
export const HKDF_INFO_ROOT_CHAIN = utf8Bytes("WhisperRootChain");
export const HKDF_INFO_CHAIN_KEY = utf8Bytes("WhisperChainKey");
export const HKDF_INFO_X3DH = utf8Bytes("WhisperX3DH");

// ==========================================================
// X25519
// ==========================================================

export function generateX25519Keypair() {
    const privateKey = randomBytes(32);
    const publicKey = x25519.getPublicKey(privateKey);
    return { privateKey, publicKey };
}

export function x25519Dh(privateKey, peerPublicKey) {
    return x25519.getSharedSecret(privateKey, peerPublicKey);
}

// noble v2 names
export function x25519SharedKey(privateKey, peerPublicKey) {
    return x25519Dh(privateKey, peerPublicKey);
}

// getPublicKey aliases (noble already stores raw)
export function x25519PublicToBytes(publicKey) {
    return publicKey;
}

// ==========================================================
// Ed25519
// ==========================================================

export function generateEd25519Keypair() {
    const privateKey = randomBytes(32);
    const publicKey = ed25519.getPublicKey(privateKey);
    return { privateKey, publicKey };
}

export function ed25519Sign(privateKey, message) {
    return ed25519.sign(message, privateKey);
}

export function ed25519Verify(publicKey, signature, message) {
    try {
        return ed25519.verify(signature, message, publicKey);
    } catch {
        return false;
    }
}

// ==========================================================
// HKDF
// ==========================================================

export function hkdf(salt, ikm, info, length = 32) {
    // !!! Parity note !!!
    // The backend's hkdf_extract()/hkdf_expand() are BOTH full HKDF
    // rounds, so the backend "hkdf" = HKDF(HKDF(ikm) as ikm). We must
    // replicate that exactly for wire compatibility:
    //   prk = HKDF(salt, ikm, info=b"", 32)
    //   out = HKDF(b"", prk, info, length)
    const prk = nobleHkdf(sha256, ikm, salt, new Uint8Array(0), 32);
    return nobleHkdf(sha256, prk, new Uint8Array(0), info, length);
}

export function kdfRootChain(rootKey, dhOutput) {
    const output = hkdf(rootKey, dhOutput, HKDF_INFO_ROOT_CHAIN, 64);
    return { rootKey: output.slice(0, 32), chainKey: output.slice(32) };
}

export function kdfChainKey(chainKey) {
    const nextChainKey = hmac(sha256, chainKey, new Uint8Array([0x01]));
    const messageKey = hmac(sha256, chainKey, new Uint8Array([0x02]));
    return { nextChainKey, messageKey };
}

export function deriveMessageKeys(messageKey) {
    const okm = hkdf(new Uint8Array(0), messageKey, HKDF_INFO_MESSAGE_KEYS, 80);
    return {
        encKey: okm.slice(0, 32),
        authKey: okm.slice(32, 64),
        nonceSeed: okm.slice(64, 96),
    };
}

// ==========================================================
// AES-256-GCM
// ==========================================================

export function aesGcmEncrypt(key, plaintext, associatedData, nonce = null) {
    if (nonce === null) nonce = randomBytes(AES_NONCE_SIZE);
    const aead = gcm(key, nonce, associatedData);
    return { ciphertext: aead.encrypt(plaintext), nonce };
}

export function aesGcmDecrypt(key, ciphertext, associatedData, nonce) {
    const aead = gcm(key, nonce, associatedData);
    return aead.decrypt(ciphertext);
}

// ==========================================================
// Helpers
// ==========================================================

function utf8Bytes(text) {
    return new TextEncoder().encode(text);
}

export { x25519, ed25519 };