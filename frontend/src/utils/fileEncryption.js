import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
} from "../crypto/signal/bytes";

import {
    importPublicKey,
    importPrivateKey,
} from "../crypto/cryptoService";

// ==========================================================
// Generate AES-256 Key
// ==========================================================

export async function generateFileKey() {

    return crypto.subtle.generateKey(

        {
            name: "AES-GCM",
            length: 256,
        },

        true,

        [
            "encrypt",
            "decrypt",
        ],

    );

}

// ==========================================================
// Encrypt File
// ==========================================================

export async function encryptFile(file) {

    // Read file

    const buffer =
        await file.arrayBuffer();

    // Generate AES Key

    const key =
        await generateFileKey();

    // Random IV

    const iv =
        crypto.getRandomValues(
            new Uint8Array(12)
        );

    // Encrypt

    const encrypted =
        await crypto.subtle.encrypt(

            {
                name: "AES-GCM",
                iv,
            },

            key,

            buffer,

        );

    // Export AES key so it can later
    // be encrypted with RSA

    const rawKey =
        await crypto.subtle.exportKey(
            "raw",
            key,
        );

    return {

        encryptedFile:
            new Blob(
                [encrypted],
                {
                    type: "application/octet-stream",
                }
            ),

        rawKey,

        iv,

    };

}

// ==========================================================
// Decrypt File
// ==========================================================

export async function decryptFile(

    encryptedBlob,

    rawKey,

    iv,

) {

    const key =
        await crypto.subtle.importKey(

            "raw",

            rawKey,

            {
                name: "AES-GCM",
            },

            false,

            [
                "decrypt",
            ],

        );

    const encrypted =
        await encryptedBlob.arrayBuffer();

    const decrypted =
        await crypto.subtle.decrypt(

            {
                name: "AES-GCM",
                iv,
            },

            key,

            encrypted,

        );

    return new Blob([decrypted]);

}

// ==========================================================
// Wrap the file's AES key for a recipient (RSA-OAEP)
//
// Returns a base64 RSA-OAEP ciphertext of the raw AES key.
// ==========================================================

export async function wrapFileKey(
    rawKey,
    publicKeyBase64,
) {

    const publicKey =
        await importPublicKey(
            publicKeyBase64
        );

    const wrapped =
        await crypto.subtle.encrypt(
            {
                name: "RSA-OAEP",
            },
            publicKey,
            rawKey,
        );

    return arrayBufferToBase64(
        wrapped
    );

}

// ==========================================================
// Unwrap the file's AES key with the local RSA private key
// ==========================================================

export async function unwrapFileKey(
    wrappedKeyBase64,
    privateKeyBase64,
) {

    const privateKey =
        await importPrivateKey(
            privateKeyBase64
        );

    const rawKey =
        await crypto.subtle.decrypt(
            {
                name: "RSA-OAEP",
            },
            privateKey,
            base64ToArrayBuffer(
                wrappedKeyBase64
            ),
        );

    return new Uint8Array(
        rawKey
    );

}