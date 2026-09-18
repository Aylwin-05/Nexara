// ==========================================================
// Nexara Signal Session Manager
//
// JSX mirror of backend/app/crypto/signal/session.py
//
// Ties together X3DH + Double Ratchet + Envelope:
//   - encryptFirst (Alice): fetch peer bundle, X3DH, init ratchet,
//     produce first prekey message.
//   - decryptFirst (Bob):  parse prekey message, X3DH, init ratchet,
//     decrypt payload, store session state.
//   - encrypt / decrypt in an established session.
// ==========================================================

import {
    x25519,
    generateX25519Keypair,
    generateEd25519Keypair,
    ed25519,
} from "./primitives.js";
import {
    x3dhInitiate,
    x3dhReceive,
    deriveX25519FromEd25519,
} from "./x3dh.js";
import { DoubleRatchetCore } from "./doubleRatchet.js";
import {
    SignalEnvelope,
    EnvelopeError,
    parsePrekeyMessage,
    SignalProtocolError,
} from "./message.js";
import { b64encode, b64decode, concatBytes } from "./bytes.js";

// ==========================================================
// Errors
// ==========================================================

export class SessionError extends SignalProtocolError {}
export class SessionNotFoundError extends SessionError {}

// ==========================================================
// Session Store (in-memory, for tests)
// ==========================================================

export class InMemorySessionStore {
    constructor() {
        this._sessions = new Map();
    }

    _key(ourDeviceId, remoteDeviceId, conversationId) {
        return `${ourDeviceId}|${remoteDeviceId}|${conversationId}`;
    }

    async get(ourDeviceId, remoteDeviceId, conversationId) {
        return this._sessions.get(
            this._key(ourDeviceId, remoteDeviceId, conversationId),
        );
    }

    async save(ourDeviceId, remoteDeviceId, conversationId, state) {
        this._sessions.set(
            this._key(ourDeviceId, remoteDeviceId, conversationId),
            state,
        );
    }

    async delete(ourDeviceId, remoteDeviceId, conversationId) {
        this._sessions.delete(
            this._key(ourDeviceId, remoteDeviceId, conversationId),
        );
    }
}

// ==========================================================
// Result
// ==========================================================

export class SessionResult {
    constructor(plaintext = new Uint8Array(0), senderDeviceId = "", newSession = false) {
        this.plaintext = plaintext;
        this.senderDeviceId = senderDeviceId;
        this.newSession = newSession;
    }
}

// ==========================================================
// Session Manager
// ==========================================================

export class SignalSessionManager {
    constructor(store) {
        this.store = store;
    }

    // ==========================================================
    // Initiator (Alice) - first message
    // ==========================================================

    async encryptFirst({
        ourDeviceId,
        ourUserId,
        ourIdentityPrivate,   // raw Ed25519 private (32 bytes)
        theirDeviceId,
        theirBundle,          // bundle dict from the server
        conversationId,
        plaintext,            // Uint8Array
    }) {
        const ourEkPriv = generateX25519Keypair().privateKey;

        const theirIkPub = b64decode(theirBundle.identity_key);
        const theirXPub = b64decode(theirBundle.x25519_identity_key);
        const spk = theirBundle.signed_prekey;
        const spkPub = b64decode(spk.public_key);
        const spkId = spk.key_id;
        const spkSig = b64decode(spk.signature);

        let opk = null;
        let opkId = null;
        if (theirBundle.one_time_prekeys?.length) {
            const first = theirBundle.one_time_prekeys[0];
            opk = b64decode(first.public_key);
            opkId = first.key_id;
        }

        // X3DH as initiator
        const x3dh = x3dhInitiate({
            ourIdentityPrivate: ourIdentityPrivate,
            ourEphemeralPrivate: ourEkPriv,
            theirIdentityPublic: theirIkPub,
            theirX25519IdentityPublic: theirXPub,
            theirSignedPrekeyPublic: spkPub,
            theirSignedPrekeySignature: spkSig,
            theirSignedPrekeyId: spkId,
            theirOneTimePrekeyPublic: opk,
            theirOneTimePrekeyId: opkId,
        });

        // AD: initiator identity || responder identity
        const ourIkPub = ed25519.getPublicKey(ourIdentityPrivate);
        const ad = buildAssociatedData(ourIkPub, theirIkPub);

        // Ratchet init (initiator timeline)
        // Alice's initial ratchet DH pair = her X3DH ephemeral key pair
        const ratchet = new DoubleRatchetCore(x3dh.sharedSecret, ad, ourEkPriv);
        ratchet.theirDhPublic = spkPub;
        ratchet.initializeInitiator();

        // Encrypt the first payload
        const { header, payload } = ratchet.encrypt_message(plaintext);

        // Save session state
        await this.store.save(
            ourDeviceId,
            theirDeviceId,
            conversationId,
            ratchet.state(),
        );

        // Build prekey envelope carrying our X3DH data
        const env = SignalEnvelope.prekey({
            deviceId: ourDeviceId,
            senderId: ourUserId || ourDeviceId,
            identityPublic: ourIkPub,
            x25519IdentityPublic: getX25519IdentityPublicRaw(ourIdentityPrivate),
            ephemeralPublic: x25519.getPublicKey(ourEkPriv),
            signedPrekeyId: spkId,
            oneTimePrekeyId: opkId,
            ratchetHeader: header,
            ciphertext: payload,
        });
        return env;
    }

    // ==========================================================
    // Encrypt - established session
    // ==========================================================

    async encrypt({
        ourDeviceId,
        ourUserId,
        remoteDeviceId,
        conversationId,
        plaintext,
    }) {
        const state = await this.store.get(
            ourDeviceId,
            remoteDeviceId,
            conversationId,
        );
        if (!state) {
            throw new SessionNotFoundError(
                "No session with remote device; use encryptFirst",
            );
        }
        const ratchet = DoubleRatchetCore.fromState(state);
        const { header, payload } = ratchet.encrypt_message(plaintext);
        await this.store.save(
            ourDeviceId,
            remoteDeviceId,
            conversationId,
            ratchet.state(),
        );
        return SignalEnvelope.data({
            deviceId: ourDeviceId,
            senderId: ourUserId || ourDeviceId,
            ratchetHeader: header,
            ciphertext: payload,
        });
    }

    // ==========================================================
    // Responder (Bob) - first message
    // ==========================================================

    async decryptFirst({
        envelope,
        ourDeviceId,
        ourIdentityKey,        // raw Ed25519 private
        signedPrekey,          // {key_id, private_key: b64}
        oneTimePrekey,         // {key_id, private_key: b64} or null
        conversationId,
    }) {
        if (envelope.type !== "prekey" || !envelope.x3dhInfo) {
            throw new SessionError("Not a handshake (prekey) envelope");
        }

        const info = parsePrekeyMessage(envelope);

        const ourIkPriv = ourIdentityKey;
        const spkPriv = b64decode(signedPrekey.private_key);

        let otpkPriv = null;
        if (oneTimePrekey) {
            otpkPriv = b64decode(oneTimePrekey.private_key);
        }

        // X3DH as responder
        const x3dh = x3dhReceive({
            theirEphemeralPublic: info.ephemeralKey,
            theirIdentityPublic: info.identityKey,
            theirX25519IdentityPublic: info.x25519IdentityKey,
            ourIdentityPrivateKey: ourIkPriv,
            ourSignedPrekeyPrivate: spkPriv,
            ourSignedPrekeyId: signedPrekey.key_id,
            ourOneTimePrekeyPrivate: otpkPriv,
            ourOneTimePrekeyId: oneTimePrekey ? oneTimePrekey.key_id : null,
        });

        // AD: initiator (Alice) first
        const ad = buildAssociatedData(
            info.identityKey,
            ed25519.getPublicKey(ourIdentityKey),
        );

        // Ratchet init (responder): Bob's initial ratchet DH pair =
        // his signed prekey pair.
        const ratchet = new DoubleRatchetCore(x3dh.sharedSecret, ad, spkPriv);

        // Decrypt the first payload
        const plaintext = ratchet.decrypt_message(
            envelope.ratchetHeader,
            b64decode(envelope.ciphertext),
        );

        await this.store.save(
            ourDeviceId,
            envelope.deviceId,
            conversationId,
            ratchet.state(),
        );
        return new SessionResult(plaintext, envelope.deviceId, true);
    }

    // ==========================================================
    // Decrypt - established session
    // ==========================================================

    async decrypt({
        envelope,
        ourDeviceId,
        conversationId,
    }) {
        if (envelope.type !== "data") {
            throw new SessionError("Not a data envelope");
        }
        const state = await this.store.get(
            ourDeviceId,
            envelope.deviceId,
            conversationId,
        );
        if (!state) {
            throw new SessionNotFoundError(
                "No session with sender device",
            );
        }
        const ratchet = DoubleRatchetCore.fromState(state);
        const plaintext = ratchet.decrypt_message(
            envelope.ratchetHeader,
            b64decode(envelope.ciphertext),
        );
        await this.store.save(
            ourDeviceId,
            envelope.deviceId,
            conversationId,
            ratchet.state(),
        );
        return new SessionResult(plaintext, envelope.deviceId, false);
    }
}

// ==========================================================
// Helpers
// ==========================================================

export function buildAssociatedData(initiatorIdentity, responderIdentity) {
    // AD = initiator IK || responder IK (raw Ed25519 public keys)
    return concatBytes(initiatorIdentity, responderIdentity);
}

function getX25519PublicRaw(ed25519PrivateKey) {
    return x25519.getPublicKey(
        deriveX25519FromEd25519(ed25519PrivateKey),
    );
}

function getX25519IdentityPublicRaw(ed25519PrivateKey) {
    return getX25519PublicRaw(ed25519PrivateKey);
}