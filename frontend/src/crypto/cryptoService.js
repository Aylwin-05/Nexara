// ==========================================================
// Nexara Crypto Service
//
// Hybrid Encryption
//
// RSA-OAEP 2048
// AES-256-GCM
//
// Browser generates and stores identity keys.
// Backend stores ONLY the public key.
// Every AES-GCM operation is bound to the conversation it
// belongs to. A ciphertext copied/moved into another context
// (by a compromised server, a replayed old message, etc.)
// then fails authentication at decrypt time instead of
// silently decrypting. The bindings below are UTF-8 encoded
// before being passed to WebCrypto.
//
// Legacy rows (encrypted before AAD existed) have no binding:
// decrypting callers retry WITHOUT the AAD as a fallback, so
// old history keeps working.
// ==========================================================

import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
} from "./signal/bytes.js";

// ==========================================================
// ADDITIONAL AUTHENTICATED DATA
//
// Every AES-GCM operation is bound to the conversation it
// belongs to. A ciphertext copied/moved into another context
// (by a compromised server, a replayed old message, etc.)
// then fails authentication at decrypt time instead of
// silently decrypting. The bindings below are UTF-8 encoded
// before being passed to WebCrypto.
//
// Legacy rows (encrypted before AAD existed) have no binding:
// decrypting callers retry WITHOUT the AAD as a fallback, so
// old history keeps working.
// ==========================================================

export const DM_AAD_PREFIX = "nexara-dm:";
export const GROUP_AAD_PREFIX = "nexara-group:";

export function encodeAAD(aadString) {

    if (!aadString) return null;

    return new TextEncoder().encode(
        aadString
    );

}

// ==========================================================
// RSA KEY GENERATION
// ==========================================================

export async function generateIdentityKeys() {

    const keyPair =
        await crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([
                    1,
                    0,
                    1,
                ]),
                hash: "SHA-256",
            },
            true,
            [
                "encrypt",
                "decrypt",
            ]
        );

    const publicKey =
        await exportPublicKey(
            keyPair.publicKey
        );

    const privateKey =
        await exportPrivateKey(
            keyPair.privateKey
        );

    return {

        publicKey,

        privateKey,

    };

}

// ==========================================================
// EXPORT PUBLIC KEY
// ==========================================================

export async function exportPublicKey(
    key
) {

    const exported =
        await crypto.subtle.exportKey(
            "spki",
            key
        );

    return arrayBufferToBase64(
        exported
    );

}

// ==========================================================
// EXPORT PRIVATE KEY
// ==========================================================

export async function exportPrivateKey(
    key
) {

    const exported =
        await crypto.subtle.exportKey(
            "pkcs8",
            key
        );

    return arrayBufferToBase64(
        exported
    );

}

// ==========================================================
// IMPORT PUBLIC KEY
// ==========================================================

export async function importPublicKey(
    base64
) {

    return await crypto.subtle.importKey(
        "spki",
        base64ToArrayBuffer(base64),
        {
            name: "RSA-OAEP",
            hash: "SHA-256",
        },
        true,
        [
            "encrypt",
        ]
    );

}

// ==========================================================
// IMPORT PRIVATE KEY
// ==========================================================

export async function importPrivateKey(
    base64
) {

    return await crypto.subtle.importKey(
        "pkcs8",
        base64ToArrayBuffer(base64),
        {
            name: "RSA-OAEP",
            hash: "SHA-256",
        },
        true,
        [
            "decrypt",
        ]
    );

}

// ==========================================================
// AES-256 KEY
// ==========================================================

export async function generateAESKey() {

    return await crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        [
            "encrypt",
            "decrypt",
        ]
    );

}

// ==========================================================
// EXPORT RAW AES KEY
// ==========================================================

async function exportAESKey(
    aesKey
) {

    return await crypto.subtle.exportKey(
        "raw",
        aesKey
    );

}

// ==========================================================
// IMPORT RAW AES KEY
// ==========================================================

async function importAESKey(
    rawKey
) {

    return await crypto.subtle.importKey(
        "raw",
        rawKey,
        {
            name: "AES-GCM",
        },
        false,
        [
            "decrypt",
        ]
    );

}

// ==========================================================
// ENCRYPT MESSAGE
// ==========================================================

export async function encryptMessage(
    plaintext,
    senderPublicKey,
    receiverPublicKey,
    aad = null,
) {

    // ----------------------------------------------
    // Optional associated data. Callers pass the
    // conversation binding; when omitted the row stays
    // UNBOUND so pre-AAD history keeps decrypting via
    // the unbound fallback in decryptMessage().
    // ----------------------------------------------

    // ----------------------------------------------
    // Generate one-time AES key
    // ----------------------------------------------

    const aesKey =
        await generateAESKey();

    // ----------------------------------------------
    // Random IV (Nonce)
    // ----------------------------------------------

    const iv =
        crypto.getRandomValues(
            new Uint8Array(12)
        );

    // ----------------------------------------------
    // Encrypt plaintext with AES-GCM
    // ----------------------------------------------

    const encoder =
        new TextEncoder();

    const encryptedMessage =
        await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv,
                additionalData:
                    encodeAAD(aad) ?? undefined,
            },
            aesKey,
            encoder.encode(
                plaintext
            )
        );

    // ----------------------------------------------
    // Export AES key
    // ----------------------------------------------

    const rawAESKey =
        await exportAESKey(
            aesKey
        );

    // ----------------------------------------------
    // Encrypt AES key using RSA
    // ----------------------------------------------

    const senderKey =
        await importPublicKey(senderPublicKey);

    const receiverKey =
        await importPublicKey(receiverPublicKey);

    const encryptedSenderKey =
        await crypto.subtle.encrypt(
            {
                name:"RSA-OAEP"
            },
            senderKey,
            rawAESKey
        );

    const encryptedReceiverKey =
        await crypto.subtle.encrypt(
            {
                name:"RSA-OAEP"
            },
            receiverKey,
            rawAESKey
        );

    // ----------------------------------------------
    // Return backend payload
    // ----------------------------------------------

    return {

        ciphertext:
            arrayBufferToBase64(
                encryptedMessage
            ),

        encrypted_key_sender:
            arrayBufferToBase64(
                encryptedSenderKey
            ),

        encrypted_key_receiver:
            arrayBufferToBase64(
                encryptedReceiverKey
            ),

        nonce:
            arrayBufferToBase64(
                iv.buffer
            ),

        message_type:"text"

    };

}

// ==========================================================
// DECRYPT MESSAGE
// ==========================================================

export async function decryptMessage(
    ciphertextBase64,
    encryptedKeyBase64,
    nonceBase64,
    privateKeyBase64,
    aad = null,
) {

    const privateKey =
        await importPrivateKey(
            privateKeyBase64
        );

    // ----------------------------------------------
    // Decrypt AES key
    // ----------------------------------------------

    const rawAESKey =
        await crypto.subtle.decrypt(
            {
                name: "RSA-OAEP",
            },
            privateKey,
            base64ToArrayBuffer(
                encryptedKeyBase64
            )
        );

    // ----------------------------------------------
    // Import AES key
    // ----------------------------------------------

    const aesKey =
        await importAESKey(
            rawAESKey
        );

    // ----------------------------------------------
    // Decrypt ciphertext (AAD first, then fall back
    // to the unbound form for pre-AAD history)
    // ----------------------------------------------

    const aadBytes =
        encodeAAD(aad);

    const attempt =
        async (useAad) => {

            const plaintext =
                await crypto.subtle.decrypt(
                    {
                        name: "AES-GCM",
                        iv: new Uint8Array(
                            base64ToArrayBuffer(
                                nonceBase64
                            )
                        ),
                        additionalData:
                            useAad && aadBytes
                                ? aadBytes
                                : undefined,
                    },
                    aesKey,
                    base64ToArrayBuffer(
                        ciphertextBase64
                    )
                );

            return new TextDecoder().decode(
                plaintext
            );

        };

    if (aadBytes) {

        try {

            return await attempt(true);

        }
        catch {

            // fall through to the unbound attempt
        }

    }

    return await attempt(false);

}