// ==========================================================
// Nexara Signal Identity & Registration Payload
//
// Generates the long-term device identity (Ed25519), the
// signed prekey (X25519) and a batch of one-time prekeys,
// then builds the payload for POST /devices/register in a
// shape identical to the backend's RegisterDeviceRequest.
// ==========================================================

import {
    generateEd25519Keypair,
    generateX25519Keypair,
    ed25519Sign,
} from "./primitives.js";
import {
    deriveX25519FromEd25519,
    getX25519IdentityPublic,
} from "./x3dh.js";
import { x25519 } from "./primitives.js";
import { b64encode, b64decode } from "./bytes.js";

// Number of one-time prekeys uploaded at registration
export const OPK_BATCH_SIZE = 100;

// ==========================================================
// Generate complete device identity material
// ==========================================================

export function generateDeviceIdentity({ signedPrekeyId = 1 } = {}) {
    const identity = generateEd25519Keypair();          // { privateKey, publicKey }
    const x25519IdentityPublic = getX25519IdentityPublic(identity.privateKey);

    const signedPrekey = generateX25519Keypair();       // { privateKey, publicKey }
    const signature = ed25519Sign(identity.privateKey, signedPrekey.publicKey);

    return {
        deviceId: null, // assigned by the caller
        identity: {
            privateKey: identity.privateKey,
            publicKey: identity.publicKey,
            x25519Public: x25519IdentityPublic,
        },
        signedPrekey: {
            keyId: signedPrekeyId,
            publicKey: signedPrekey.publicKey,
            signature,
            privateKey: signedPrekey.privateKey,
        },
    };
}

// ==========================================================
// Generate one-time prekeys (public + private)
// ==========================================================

export function generateOneTimePrekeys({ startId = 1, count = OPK_BATCH_SIZE } = {}) {
    const opks = [];
    for (let i = 0; i < count; i++) {
        const keyPair = generateX25519Keypair();
        opks.push({
            keyId: startId + i,
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
        });
    }
    return opks;
}

// ==========================================================
// Build the /devices/register payload
//
// ONLY public key material is uploaded. The private halves of
// every key stay in the local IndexedDB key store, so the
// server can never decrypt sessions.
// ==========================================================

export function buildRegisterPayload({
    deviceId,
    platform = "web",
    deviceName = null,
    platformVersion = null,
    appVersion = null,
    identity,              // from generateDeviceIdentity()
    signedPrekey,          // from generateDeviceIdentity()
    oneTimePrekeys,        // from generateOneTimePrekeys()
}) {
    return {
        device_id: deviceId,
        platform,
        device_name: deviceName,
        platform_version: platformVersion,
        app_version: appVersion,
        identity_key_public: b64encode(identity.publicKey),
        identity_key_x25519: b64encode(identity.x25519Public),
        signed_prekey_public: b64encode(signedPrekey.publicKey),
        signed_prekey_id: signedPrekey.keyId,
        signed_prekey_signature: b64encode(signedPrekey.signature),
        one_time_prekeys: oneTimePrekeys.map((opk) => ({
            key_id: opk.keyId,
            public_key: b64encode(opk.publicKey),
        })),
    };
}

// ==========================================================
// Device ID generation
// ==========================================================

export function generateDeviceId() {
    return `web-${crypto.randomUUID()}`;
}

// ==========================================================
// Generate a fresh signed prekey for rotation
//
// The identity key (Ed25519) stays the same; only the X25519
// signed prekey is replaced. The caller must pass the
// identity private key and the next key ID.
// ==========================================================

export function generateSignedPrekey({
    identityPrivateKey,
    keyId,
}) {
    const spk = generateX25519Keypair();
    const signature = ed25519Sign(identityPrivateKey, spk.publicKey);

    return {
        keyId,
        publicKey: spk.publicKey,
        privateKey: spk.privateKey,
        signature,
    };
}

export { b64encode, b64decode };