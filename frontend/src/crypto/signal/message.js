// ==========================================================
// Nexara Signal Message Envelope
//
// JSX mirror of backend/app/crypto/signal/message.py
//
// Wire format (JSON):
// {
//   "type": "prekey" | "data",
//   "version": 1,
//   "device_id": "sender device id",
//   "sender_id":  "sender user id",
//   "x3dh": {                      # only for type=prekey
//       "identity_key": "b64",       # sender Ed25519 identity public
//       "x25519_identity_key": "b64",
//       "ephemeral_key": "b64",      # sender X25519 ephemeral public
//       "signed_prekey_id": 1,
//       "one_time_prekey_id": 3      # optional
//   },
//   "ratchet": {                   # Double Ratchet header
//       "pn": 0,
//       "n": 0,
//       "dh": "hex"
//   },
//   "ciphertext": "b64"
// }
// ==========================================================

import { b64encode, b64decode } from "./bytes.js";
import { ed25519, x25519 } from "./primitives.js";
import {
    deriveX25519FromEd25519,
    getX25519IdentityPublic,
} from "./x3dh.js";

const ENVELOPE_VERSION = 1;

// ==========================================================
// Errors
// ==========================================================

export class SignalProtocolError extends Error {}
export class EnvelopeError extends SignalProtocolError {}

// ==========================================================
// Envelope
// ==========================================================

export class SignalEnvelope {
    constructor({
        type,
        deviceId,
        senderId,
        ratchetHeader,
        ciphertext,
        x3dhInfo = null,
    }) {
        this.type = type;
        this.deviceId = deviceId;
        this.senderId = senderId;
        this.ratchetHeader = ratchetHeader;
        this.ciphertext = ciphertext;
        this.x3dhInfo = x3dhInfo;
    }

    toJson() {
        return JSON.stringify({
            type: this.type,
            version: ENVELOPE_VERSION,
            device_id: this.deviceId,
            sender_id: this.senderId,
            x3dh: this.x3dhInfo,
            ratchet: this.ratchetHeader,
            ciphertext: this.ciphertext,
        });
    }

    toBytes() {
        return new TextEncoder().encode(this.toJson());
    }

    static fromJson(raw) {
        let data;
        try {
            data = JSON.parse(raw);
        } catch {
            throw new EnvelopeError("Malformed envelope: invalid JSON");
        }
        const version = data.version ?? -1;
        if (version !== ENVELOPE_VERSION) {
            throw new EnvelopeError(
                `Unsupported protocol version: ${version}`,
            );
        }
        if (
            !data.type ||
            typeof data.device_id !== "string" ||
            typeof data.sender_id !== "string" ||
            !data.ratchet ||
            typeof data.ciphertext !== "string"
        ) {
            throw new EnvelopeError("Malformed envelope: missing fields");
        }
        return new SignalEnvelope({
            type: data.type,
            deviceId: data.device_id,
            senderId: data.sender_id,
            ratchetHeader: data.ratchet,
            ciphertext: data.ciphertext,
            x3dhInfo: data.x3dh ?? null,
        });
    }

    static prekey({
        deviceId,
        senderId,
        identityPublic,         // Ed25519 public bytes
        ephemeralPublic,        // X25519 public bytes
        x25519IdentityPublic,   // X25519 public bytes
        signedPrekeyId,
        oneTimePrekeyId,
        ratchetHeader,
        ciphertext,             // bytes
    }) {
        const info = {
            identity_key: b64encode(identityPublic),
            x25519_identity_key: b64encode(x25519IdentityPublic),
            ephemeral_key: b64encode(ephemeralPublic),
            signed_prekey_id: signedPrekeyId,
        };
        if (oneTimePrekeyId !== null && oneTimePrekeyId !== undefined) {
            info.one_time_prekey_id = oneTimePrekeyId;
        }
        return new SignalEnvelope({
            type: "prekey",
            deviceId,
            senderId,
            ratchetHeader,
            ciphertext: b64encode(ciphertext),
            x3dhInfo: info,
        });
    }

    static data({ deviceId, senderId, ratchetHeader, ciphertext }) {
        return new SignalEnvelope({
            type: "data",
            deviceId,
            senderId,
            ratchetHeader,
            ciphertext: b64encode(ciphertext),
        });
    }
}

// ==========================================================
// Build a prekey (handshake) envelope
// ==========================================================

export function buildPrekeyMessage({
    deviceId,
    senderId,
    ourIdentityPrivate,     // Ed25519 private
    ourEphemeralPrivate,    // X25519 private
    ratchetHeader,
    ciphertext,             // bytes
    signedPrekeyId,
    oneTimePrekeyId = null,
}) {
    const ourIkPub = ed25519.getPublicKey(ourIdentityPrivate);
    const x25519IkPub = getX25519IdentityPublic(ourIdentityPrivate);
    const ekPub = x25519.getPublicKey(ourEphemeralPrivate);

    const info = {
        identity_key: b64encode(ourIkPub),
        x25519_identity_key: b64encode(x25519IkPub),
        ephemeral_key: b64encode(ekPub),
        signed_prekey_id: signedPrekeyId,
    };
    if (oneTimePrekeyId !== null && oneTimePrekeyId !== undefined) {
        info.one_time_prekey_id = oneTimePrekeyId;
    }

    return new SignalEnvelope({
        type: "prekey",
        deviceId,
        senderId,
        ratchetHeader,
        ciphertext: b64encode(ciphertext),
        x3dhInfo: info,
    });
}

// ==========================================================
// Parse prekey message (extract X3DH initiator data)
// ==========================================================

export function parsePrekeyMessage(envelope) {
    if (envelope.type !== "prekey" || !envelope.x3dhInfo) {
        throw new EnvelopeError("Not a prekey message");
    }
    const info = envelope.x3dhInfo;
    return {
        identityKey: b64decode(info.identity_key),
        x25519IdentityKey: b64decode(info.x25519_identity_key),
        ephemeralKey: b64decode(info.ephemeral_key),
        signedPrekeyId: info.signed_prekey_id,
        oneTimePrekeyId: info.one_time_prekey_id ?? null,
    };
}