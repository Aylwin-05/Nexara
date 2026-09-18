// ==========================================================
// Nexara One-Time PreKey Manager
//
// The client owns the private halves of every one-time prekey
// (they must live in the local key store so this device can
// decrypt X3DH handshakes addressed to it). This module keeps
// the local pool topped up and mirrors the generated batch to
// the server so peers can initiate new sessions.
//
// Pure logic: the upload callback is injected so the module
// stays runnable under node --test.
// ==========================================================

import { signalKeyStore } from "./keyStore.js";
import { generateOneTimePrekeys, generateSignedPrekey } from "./identity.js";
import { b64encode } from "./bytes.js";

export const DEFAULT_THRESHOLD = 20;
export const DEFAULT_BATCH_SIZE = 100;

// ==========================================================
// Replenish the local one-time prekey pool if it runs low
// ==========================================================

export async function replenishOneTimePrekeys({
    keyStore = signalKeyStore,
    threshold = DEFAULT_THRESHOLD,
    batchSize = DEFAULT_BATCH_SIZE,
    upload = null,
} = {}) {
    const count = await keyStore.getOneTimePrekeyCount();

    if (count >= threshold) {
        return {
            replenished: 0,
            count,
            uploaded: 0,
        };
    }

    const existing = await keyStore.getAllOneTimePrekeys();
    const nextId =
        existing.reduce(
            (max, prekey) => Math.max(max, prekey.keyId),
            0,
        ) + 1;

    const generated = generateOneTimePrekeys({
        startId: nextId,
        count: batchSize,
    });

    const local = generated.map((opk) => ({
        keyId: opk.keyId,
        publicKey: b64encode(opk.publicKey),
        privateKey: b64encode(opk.privateKey),
    }));

    // Persist locally FIRST so the device can always decrypt
    // handshakes even if the upload below fails.
    await keyStore.saveOneTimePrekeys(local);

    let uploaded = 0;
    if (upload) {
        const payload = generated.map((opk) => ({
            key_id: opk.keyId,
            public_key: b64encode(opk.publicKey),
        }));
        try {
            await upload(payload);
            uploaded = payload.length;
        } catch {
            // Non-fatal: next replenish attempt retries the upload.
        }
    }

    return {
        replenished: local.length,
        count: count + local.length,
        uploaded,
    };
}

// ==========================================================
// Signed PreKey rotation
//
// Checks the stored SPK's expires_at; if it has passed (or
// is within the grace window), generates a fresh X25519
// keypair, signs it with the identity key, persists it
// locally, and uploads the public half to the server.
// ==========================================================

export const SPK_GRACE_DAYS = 3;

export async function replenishSignedPrekey({
    keyStore = signalKeyStore,
    graceDays = SPK_GRACE_DAYS,
    upload = null,
} = {}) {
    const identity = await keyStore.getIdentity();
    if (!identity) {
        return { rotated: false, reason: "no_identity" };
    }

    const allSpks = await keyStore.getAllSignedPrekeys();
    const current = allSpks.length > 0
        ? allSpks.reduce((a, b) => (a.keyId > b.keyId ? a : b))
        : null;

    if (current && current.expiresAt) {
        const expiresAt = new Date(current.expiresAt);
        const graceMs = graceDays * 24 * 60 * 60 * 1000;
        const now = Date.now();
        if (expiresAt.getTime() - now > graceMs) {
            return { rotated: false, reason: "not_due" };
        }
    }

    const nextId = current ? current.keyId + 1 : 1;

    const spk = generateSignedPrekey({
        identityPrivateKey: keyStore._rawPrivateKey
            ? keyStore._rawPrivateKey
            : identity.privateKey,
        keyId: nextId,
    });

    await keyStore.saveSignedPrekey({
        keyId: spk.keyId,
        publicKey: b64encode(spk.publicKey),
        privateKey: b64encode(spk.privateKey),
        signature: b64encode(spk.signature),
    });

    let uploaded = false;
    if (upload) {
        try {
            await upload({
                key_id: spk.keyId,
                public_key: b64encode(spk.publicKey),
                signature: b64encode(spk.signature),
            });
            uploaded = true;
        } catch {
            // Non-fatal: next attempt retries the upload.
        }
    }

    return {
        rotated: true,
        keyId: spk.keyId,
        uploaded,
    };
}