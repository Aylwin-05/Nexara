import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
} from "../crypto/signal/bytes";

import {
    generateFileKey,
    wrapFileKey,
} from "./fileEncryption";

import {
    decryptMessage,
    GROUP_AAD_PREFIX,
    encodeAAD,
} from "../crypto/cryptoService";

import {
    encryptBytesForDevices,
    decryptEnvelopeBytes,
} from "../services/signalChatService";

import { signalKeyStore } from "../crypto/signal/keyStore";

import deviceService from "../services/deviceService";

// ==========================================================
// GROUP CHAT ENCRYPTION
//
// A group message is encrypted with a FRESH AES-256-GCM key.
// That key is then delivered per DEVICE as a Signal envelope
// (X3DH / ratchet) — the same mechanism DMs use — so every
// device of every member can unwrap it and decrypt, including
// a user's OTHER browsers. For backwards compatibility the
// legacy RSA-OAEP wrapped copies (one per member's public key)
// are still attached; new clients prefer the device envelopes.
// The server stores ciphertext + wrapped copies only — never
// plaintext, never the raw key.
// ==========================================================

// ==========================================================
// Encrypt a group message for a set of members
//
// members: [{ user_id, public_key? }, ...]
// Returns the backend payload: ciphertext, nonce and the
// per-device envelope list (plus legacy per-user wraps).
// ==========================================================

export async function encryptGroupMessage(
    plaintext,
    members,
    conversationId,
) {

    const key =
        await generateFileKey();

    const iv =
        crypto.getRandomValues(
            new Uint8Array(12)
        );

    const encoder =
        new TextEncoder();

    const encryptedMessage =
        await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv,
                // Bind the ciphertext to this group: a copy
                // moved into another conversation fails GCM
                // authentication at decrypt time.
                additionalData:
                    encodeAAD(
                        GROUP_AAD_PREFIX +
                        conversationId
                    ),
            },
            key,
            encoder.encode(
                plaintext
            )
        );

    const rawKey =
        await crypto.subtle.exportKey(
            "raw",
            key,
        );

    // -------------------------------------------------
    // Legacy per-user RSA wraps (backwards compatible)
    // -------------------------------------------------

    const recipientKeys = [];

    for (const member of members) {

        if (!member?.public_key) continue;

        recipientKeys.push({

            user_id:
                member.user_id,

            encrypted_key:
                await wrapFileKey(
                    rawKey,
                    member.public_key,
                ),

        });

    }

    // -------------------------------------------------
    // Per-device envelopes: fetch every member's bundle
    // (their other devices included) and deliver the AES
    // key to each device as a Signal envelope.
    // -------------------------------------------------

    const envelopes = [];

    if (members.length) {

        const bundles = await Promise.all(
            members.map(async (member) => {

                try {

                    return await deviceService.getBundle(
                        member.user_id
                    );

                }
                catch {

                    // No registered device — nothing to wrap for.
                    return null;

                }

            })
        );

        const allDevices = bundles.flatMap(
            (bundle) => bundle?.devices ?? []
        );

        const wrapped =
            await encryptBytesForDevices({
                conversationId,
                bytes: rawKey,
                devices: allDevices,
            });

        for (const entry of wrapped) {

            envelopes.push({
                device_id: entry.device_id,
                data: entry.data,
            });

        }

    }

    return {

        ciphertext:
            arrayBufferToBase64(
                encryptedMessage
            ),

        encrypted_key_sender:
            "signal",

        encrypted_key_receiver:
            "signal",

        nonce:
            arrayBufferToBase64(
                iv.buffer
            ),

        message_type:
            "text",

        recipient_keys:
            recipientKeys,

        envelopes,

    };

}

// ==========================================================
// Decrypt a group message
//
// 1. NEW: unwrap OUR device's envelope (Signal session),
//    which yields the AES key, then AES-decrypt the payload.
// 2. FALLBACK: legacy RSA path — find the wrapped key copy
//    addressed to the current user and unwrap it.
// ==========================================================

export async function decryptGroupMessage(
    message,
    privateKeyBase64,
    currentUserId,
    myDeviceId = null,
) {

    // -------------------------------------------------
    // Per-device envelope path
    // -------------------------------------------------

    if (
        myDeviceId &&
        message.envelopes?.length
    ) {

        const ownEnvelope = message.envelopes.find(
            entry => entry.device_id === myDeviceId
        );

        if (ownEnvelope) {

            try {

                const rawKey =
                    await decryptEnvelopeBytes({
                        conversationId:
                            message.conversation_id,
                        envelopeJson:
                            ownEnvelope.data,
                        keyStore: signalKeyStore,
                    });

                const aesKey =
                    await crypto.subtle.importKey(
                        "raw",
                        rawKey,
                        "AES-GCM",
                        false,
                        ["decrypt"],
                    );

                const decrypted =
                    await crypto.subtle.decrypt(
                        {
                            name: "AES-GCM",
                            iv:
                                base64ToArrayBuffer(
                                    message.nonce
                                ),
                            // Must match the AAD used at
                            // encrypt time (see
                            // encryptGroupMessage), otherwise
                            // GCM authentication always fails.
                            additionalData:
                                encodeAAD(
                                    GROUP_AAD_PREFIX +
                                    message.conversation_id
                                ),
                        },
                        aesKey,
                        base64ToArrayBuffer(
                            message.ciphertext
                        ),
                    );

                return new TextDecoder().decode(
                    decrypted
                );

            }
            catch (error) {

                console.error(
                    "Failed to decrypt group envelope:",
                    error
                );

            }

        }

    }

    // -------------------------------------------------
    // Legacy RSA path (older messages)
    // -------------------------------------------------

    const ownKey = (
        message.recipient_keys ?? []
    ).find(
        key =>
            String(key.user_id) ===
            String(currentUserId)
    );

    if (!ownKey) {

        throw new Error(
            "No key copy for this user."
        );

    }

    return await decryptMessage(
        message.ciphertext,
        ownKey.encrypted_key,
        message.nonce,
        privateKeyBase64,
        GROUP_AAD_PREFIX + message.conversation_id,
    );

}
