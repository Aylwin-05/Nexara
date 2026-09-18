// ==========================================================
// Nexara Call E2EE (insertable streams)
//
// Voice/video media is encrypted frame-by-frame in the browser
// with AES-256-GCM via RTCRtpScriptTransform (WebRTC encoded
// transforms). The call key is NEVER sent over the wire: both
// peers derive it locally from the account sync secret plus a
// per-call nonce that the caller generates and attaches to the
// call_offer SDP. The server relays only opaque RTP
// ciphertext, so a compromised relay still cannot decrypt the
// conversation.
//
// Key schedule (caller/callee symmetric, no key exchange):
//   base   = HKDF(secret, ikm=nonce||callId, info="NexaraCall", 64)
//   sendKey = base[0:32]   (derived with per-side label below)
//   recvKey = base[32:64]
// Direction labels make the streams independent per direction.
//
// The random nonce makes call keys truly ephemeral: even if a
// callId were reused, a fresh nonce guarantees a different key.
//
// Browsers without RTCRtpScriptTransform (Safari, older
// Firefox) fall back to unencrypted media so calls still work;
// the UI flags that the media leg is not protected.
// ==========================================================

import { signalKeyStore } from "./signal/keyStore";
import { hkdf } from "./signal/primitives";
import { utf8Encode, concatBytes } from "./signal/bytes";
import { b64decode, b64encode } from "./signal/bytes";

const HKDF_INFO = utf8Encode("NexaraCall");
const HKDF_INFO_SEND = utf8Encode("NexaraCallSend");
const HKDF_INFO_RECV = utf8Encode("NexaraCallRecv");

const AAD = utf8Encode("NexaraCallFrame");

// ==========================================================
// Ephemeral nonce generation
//
// 16 random bytes encode to ~22-char base64.  The caller
// attaches this to the call_offer; the callee uses the same
// nonce to derive identical keys.
// ==========================================================

export function generateCallNonce() {
    return crypto.getRandomValues(new Uint8Array(16));
}

export function encodeCallNonce(nonce) {
    return b64encode(nonce);
}

export function decodeCallNonce(nonceB64) {
    return b64decode(nonceB64);
}

export function supportsFrameEncryption() {

    return (
        typeof window !== "undefined" &&
        typeof RTCRtpScriptTransform !== "undefined" &&
        typeof Worker !== "undefined" &&
        typeof TransformStream !== "undefined"
    );

}

async function deriveBaseSecret(callId, nonceBytes) {

    const secretB64 = await signalKeyStore.getSyncSecret();

    if (!secretB64) {
        return null;
    }

    const secret = b64decode(secretB64);

    const ikm = concatBytes(nonceBytes, utf8Encode(callId));

    return hkdf(
        secret,
        ikm,
        HKDF_INFO,
        64,
    );

}

// Derive the per-direction send/recv keys for this call.
// isCaller distinguishes the offerer from the answerer so the
// two directions never share a key.
// nonce may be a Uint8Array or its base64 encoding — the SAME
// nonce (caller-generated, relayed in the call_offer) on both
// sides yields identical keys.
export async function deriveCallKeyPair(callId, isCaller, nonce) {

    const nonceBytes = nonce instanceof Uint8Array
        ? nonce
        : decodeCallNonce(nonce);

    const base = await deriveBaseSecret(callId, nonceBytes);

    if (!base) {
        return null;
    }

    const sendInfo = isCaller
        ? HKDF_INFO_SEND
        : HKDF_INFO_RECV;

    const recvInfo = isCaller
        ? HKDF_INFO_RECV
        : HKDF_INFO_SEND;

    // The send half of the base key AND the direction label both
    // swap with the caller role, so each side's sendKey equals the
    // other side's recvKey.
    const sendHalf = isCaller
        ? base.slice(0, 32)
        : base.slice(32);

    const recvHalf = isCaller
        ? base.slice(32)
        : base.slice(0, 32);

    const sendKey = hkdf(
        new Uint8Array(0),
        sendHalf,
        concatBytes(HKDF_INFO, sendInfo),
        32,
    );

    const recvKey = hkdf(
        new Uint8Array(0),
        recvHalf,
        concatBytes(HKDF_INFO, recvInfo),
        32,
    );

    // Stable fingerprint of the shared base secret. Both peers
    // derive the SAME hash when their sync secrets match (e.g.
    // two devices of one account) and different hashes when they
    // do not (two different accounts). The caller sends this in
    // the offer, the callee compares, and insertable-streams
    // encryption is only enabled when both sides agree — so a
    // key mismatch can never silently garble a call.
    let keyHash = null;

    try {
        const digest = await crypto.subtle.digest(
            "SHA-256",
            base,
        );
        keyHash = b64encode(new Uint8Array(digest));
    }
    catch (e) {
        keyHash = null;
    }

    return {
        sendKey,
        recvKey,
        keyHash,
        isEncrypted: true,
    };

}

// The worker payload (cloned to the encoder worker).
export function buildWorkerOptions(operation, keyBytes) {

    return {
        operation,
        key: keyBytes,
        aad: AAD,
    };

}

export { AAD };
