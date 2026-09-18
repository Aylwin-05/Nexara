// ==========================================================
// Nexara X3DH (Extended Triple Diffie-Hellman) Key Agreement
//
// JSX mirror of backend/app/crypto/signal/x3dh.py
//
// Key hierarchy:
//   Identity Key (IK): Ed25519, long-term
//   Signed PreKey (SPK): X25519, signed by IK
//   One-Time PreKeys (OPK): X25519, ephemeral
//   Ephemeral Key (EK): X25519, per-session
//
// Derives an X25519 identity key from the Ed25519 identity key
// via HKDF; X3DH then computes:
//   DH1 = DH(EK_A, SPK_B)
//   DH2 = DH(IK_A_X25519, SPK_B)
//   DH3 = DH(EK_A, IK_B_X25519)
//   DH4 = DH(EK_A, OPK_B)  [optional]
//   SK = HKDF(salt=0x00..00, DH1||DH2||DH3||DH4, "WhisperX3DH", 32)
// ==========================================================

import {
    x25519,
    ed25519,
    hkdf,
    ed25519Verify,
    ed25519Sign,
    x25519PublicToBytes,
    x25519SharedKey,
} from "./primitives.js";
import {
    b64encode,
    b64decode,
    hexEncode,
    concatBytes,
} from "./bytes.js";

const HKDF_INFO_IDENTITY_TO_X25519 =
    new TextEncoder().encode("Signal-Identity-To-X25519");
const HKDF_INFO_X3DH = new TextEncoder().encode("WhisperX3DH");

// ==========================================================
// Key Derivation: Ed25519 -> X25519
// ==========================================================

export function deriveX25519FromEd25519(ed25519PrivateKey) {
    const x25519PrivateKey = hkdf(
        new Uint8Array(0),
        ed25519PrivateKey,
        HKDF_INFO_IDENTITY_TO_X25519,
        32,
    );
    return x25519PrivateKey;
}

export function getX25519IdentityPublic(ed25519PrivateKey) {
    return x25519.getPublicKey(deriveX25519FromEd25519(ed25519PrivateKey));
}

// ==========================================================
// Key Bundle (what's published to the server)
// ==========================================================

export function createKeyBundle({
    deviceId,
    identityKeyPrivate,
    signedPrekeyPrivate,
    signedPrekeyId,
    oneTimePrekeys, // [{keyId, privateKey}]
}) {
    const identityPublic = ed25519.getPublicKey(identityKeyPrivate);
    const x25519IdentityPublic = getX25519IdentityPublic(identityKeyPrivate);
    const signedPrekeyPublic = x25519.getPublicKey(signedPrekeyPrivate);

    const spkBytes = signedPrekeyPublic;
    const signature = ed25519Sign(identityKeyPrivate, spkBytes);

    return {
        device_id: deviceId,
        identity_key: b64encode(identityPublic),
        x25519_identity_key: b64encode(x25519IdentityPublic),
        signed_prekey: {
            key_id: signedPrekeyId,
            public_key: b64encode(signedPrekeyPublic),
            signature: b64encode(signature),
        },
        one_time_prekeys: oneTimePrekeys.map(({ keyId, privateKey }) => ({
            key_id: keyId,
            public_key: b64encode(x25519.getPublicKey(privateKey)),
        })),
    };
}

// ==========================================================
// X3DH as the Initiator (Alice)
// ==========================================================

export function x3dhInitiate({
    ourIdentityPrivate,          // Ed25519 private
    ourEphemeralPrivate,         // X25519 private
    theirIdentityPublic,         // Ed25519 public
    theirX25519IdentityPublic,   // X25519 public
    theirSignedPrekeyPublic,     // X25519 public
    theirSignedPrekeySignature,  // Ed25519 signature
    theirSignedPrekeyId,
    theirOneTimePrekeyPublic = null,
    theirOneTimePrekeyId = null,
}) {
    // Verify the signed prekey signature
    if (!ed25519Verify(
        theirIdentityPublic,
        theirSignedPrekeySignature,
        theirSignedPrekeyPublic,
    )) {
        throw new Error("Invalid signed prekey signature");
    }

    // DH1 = DH(EK_A, SPK_B)
    const dh1 = x25519SharedKey(ourEphemeralPrivate, theirSignedPrekeyPublic);

    // DH2 = DH(IK_A_X25519, SPK_B)
    const ourX25519Identity = deriveX25519FromEd25519(ourIdentityPrivate);
    const dh2 = x25519SharedKey(ourX25519Identity, theirSignedPrekeyPublic);

    // DH3 = DH(EK_A, IK_B_X25519)
    const dh3 = x25519SharedKey(ourEphemeralPrivate, theirX25519IdentityPublic);

    // DH4 = DH(EK_A, OPK_B) [optional]
    const parts = [dh1, dh2, dh3];
    if (theirOneTimePrekeyPublic) {
        parts.push(x25519SharedKey(ourEphemeralPrivate, theirOneTimePrekeyPublic));
    }

    const dhCombined = concatBytes(...parts);

    // SK = KDF(salt=0x00*32, DH1||DH2||DH3||DH4, "WhisperX3DH")
    const sharedSecret = hkdf(
        new Uint8Array(32),
        dhCombined,
        HKDF_INFO_X3DH,
        32,
    );

    // Associated data (all public keys used)
    const ephemeralPublic = x25519.getPublicKey(ourEphemeralPrivate);
    const adParts = [
        ephemeralPublic,
        theirSignedPrekeyPublic,
        theirX25519IdentityPublic,
    ];
    if (theirOneTimePrekeyPublic) {
        adParts.push(theirOneTimePrekeyPublic);
    }

    return {
        sharedSecret,
        associatedData: concatBytes(...adParts),
        usedOneTimePrekeyId: theirOneTimePrekeyId,
    };
}

// ==========================================================
// X3DH as the Responder (Bob)
// ==========================================================

export function x3dhReceive({
    theirEphemeralPublic,
    theirIdentityPublic,
    theirX25519IdentityPublic,
    ourIdentityPrivateKey,
    ourSignedPrekeyPrivate,
    ourSignedPrekeyId,
    ourOneTimePrekeyPrivate = null,
    ourOneTimePrekeyId = null,
}) {
    // DH1 = DH(SPK_B, EK_A)
    const dh1 = x25519SharedKey(ourSignedPrekeyPrivate, theirEphemeralPublic);

    // DH2 = DH(SPK_B, IK_A_X25519)
    const dh2 = x25519SharedKey(
        ourSignedPrekeyPrivate,
        theirX25519IdentityPublic,
    );

    // DH3 = DH(IK_B_X25519, EK_A)
    const ourX25519Identity = deriveX25519FromEd25519(ourIdentityPrivateKey);
    const ourX25519IdentityPub = x25519.getPublicKey(ourX25519Identity);
    const dh3 = x25519SharedKey(ourX25519Identity, theirEphemeralPublic);

    // DH4 = DH(OPK_B, EK_A) [if OPK exists]
    const parts = [dh1, dh2, dh3];
    let opkPublic = null;
    if (ourOneTimePrekeyPrivate) {
        parts.push(x25519SharedKey(ourOneTimePrekeyPrivate, theirEphemeralPublic));
        opkPublic = x25519.getPublicKey(ourOneTimePrekeyPrivate);
    }

    const dhCombined = concatBytes(...parts);

    const sharedSecret = hkdf(
        new Uint8Array(32),
        dhCombined,
        HKDF_INFO_X3DH,
        32,
    );

    const adParts = [
        theirEphemeralPublic,
        x25519.getPublicKey(ourSignedPrekeyPrivate),
        ourX25519IdentityPub,
    ];
    if (opkPublic) {
        adParts.push(opkPublic);
    }

    return {
        sharedSecret,
        associatedData: concatBytes(...adParts),
        usedOneTimePrekeyId: ourOneTimePrekeyId,
    };
}

// Alias kept for parity with the Python API name used in tests/docs
export { b64encode, b64decode, hexEncode };
