import api, { getConfiguredServer } from "../api/api";
import { getPrivateKey } from "../crypto/keyStorage";
import { base64ToArrayBuffer } from "../crypto/signal/bytes";
import {
    signalKeyStore,
} from "../crypto/signal/keyStore";
import {
    decryptEnvelopeBytes,
} from "./signalChatService";
import {
    decryptFile,
    unwrapFileKey,
} from "../utils/fileEncryption";
import { logger } from "../utils/logger";

import {
    encryptSyncBytes,
    decryptSyncBytes,
} from "../crypto/syncCrypto";

// ==========================================================
// Attachment cannot be decrypted with THIS device's keys
//
// Raised when every available file-key candidate (legacy RSA
// self/receiver wrap and per-device Signal envelope) fails.
// Attachments whose keys were created before a device
// re-registration are permanently undecryptable (E2EE key
// material exists nowhere else) — callers use this to show a
// placeholder instead of retrying forever.
// ==========================================================

export class AttachmentDecryptError extends Error {

    constructor(message, cause = null) {

        super(message);

        this.name = "AttachmentDecryptError";

        this.cause = cause;

    }

}

// In-memory decrypted-blob cache, per-device failure marks and
// in-flight dedup.
//
// Blobs are immutable once uploaded, so a successful decrypt
// can be reused for the rest of the page session (StrictMode
// double effects, the history pass and MessageBubble both
// loading the same images, conversation re-opens). Failed
// attachments are remembered so they are NOT re-downloaded and
// re-decrypted on every mount, and concurrent callers share a
// single in-flight attempt instead of downloading and logging
// the same attachment twice.
const blobCache = new Map();

const failedCache = new Map(); // deviceId -> Set(attachmentId)

const inFlight = new Map(); // cacheKey -> Promise

function cacheKey(deviceId, attachmentId) {
    return `${deviceId ?? "?"}:${attachmentId}`;
}

const attachmentService = {

    // ==========================================================
    // Upload a client-side generated thumbnail + media metadata
    // ==========================================================

    async uploadThumbnail(attachmentId, thumbFile, meta = {}) {
        const formData = new FormData();
        formData.append("thumbnail", thumbFile);
        if (meta.width != null) formData.append("width", String(meta.width));
        if (meta.height != null) formData.append("height", String(meta.height));
        if (meta.duration != null) formData.append("duration", String(meta.duration));

        const response = await api.post(
            `/attachments/${attachmentId}/thumbnail`,
            formData,
            {
                headers: { "Content-Type": "multipart/form-data" },
            }
        );
        return response.data;
    },

    // ==========================================================
    // Fetch thumbnail (unencrypted, small preview)
    // ==========================================================

    thumbnailUrl(id) {
        const base = getConfiguredServer();
        return `${base}/api/v1/attachments/${id}/thumbnail`;
    },

    async upload(messageId, file) {

        const formData = new FormData();

        formData.append("file", file);

        const response = await api.post(

            `/attachments/upload/${messageId}`,

            formData,

            {
                headers: {
                    "Content-Type": "multipart/form-data",
                },
            }

        );

        return response.data;

    },

    downloadUrl(id) {

        const base = getConfiguredServer();

        return `${base}/api/v1/attachments/${id}`;

    },

    // ==========================================================
    // Get Attachment (decrypted when a file key is provided)
    //
    // Unwrap strategies are tried in order until one decrypts
    // the blob:
    //   1. legacy RSA (`wrappedKey` + local private key) —
    //      the fast path for the profile that registered the
    //      keys and for the sender's own device;
    //   2. the per-device Signal envelope (`wrappedKeys` +
    //      the parent `message` for its conversation) — lets
    //      every registered device decrypt received files.
    // ==========================================================

async getAttachment(
        id,
        {
            wrappedKey = null,
            nonce = null,
            wrappedKeys = null,
            message = null,
            syncBlob = null,
        } = {},
    ) {

        // Failures are permanent for the page session: never
        // re-download and re-decrypt an attachment whose keys
        // are known to be gone (this device cannot decrypt it).
        const meta = await signalKeyStore.getMeta();

        const deviceId = meta?.deviceId ?? null;

        if (failedCache.get(deviceId)?.has(id)) {

            throw new AttachmentDecryptError(
                "Attachment cannot be decrypted on this device "
                + "(its keys are no longer available)."
            );

        }

        const cachedKey = cacheKey(deviceId, id);

        if (blobCache.has(cachedKey)) {

            return blobCache.get(cachedKey);

        }

        if (inFlight.has(cachedKey)) {

            // Concurrent callers (StrictMode double effects, the
            // history pre-load pass and MessageBubble) share one
            // download + decrypt instead of duplicating work.
            return inFlight.get(cachedKey);

        }

        const attempt = this._fetchAndDecrypt(
            id,
            {
                wrappedKey,
                nonce,
                wrappedKeys,
                message,
                syncBlob,
            },
            cachedKey,
            deviceId,
        );

        inFlight.set(cachedKey, attempt);

        try {

            return await attempt;

        }
        finally {

            inFlight.delete(cachedKey);

        }

    },

    // ==========================================================
    // Single download + decrypt attempt (shared via inFlight)
    // ==========================================================

    async _fetchAndDecrypt(
        id,
        {
            wrappedKey = null,
            nonce = null,
            wrappedKeys = null,
            message = null,
            syncBlob = null,
        },
        cachedKey,
        deviceId,
    ) {

        const response = await api.get(

            `/attachments/${id}`,

            {
                responseType: "blob",
            }

        );

        let blob = response.data;

        if (
            wrappedKey ||
            nonce ||
            wrappedKeys?.length
        ) {

            let lastError = null;

            // Candidate unwraps, tried in order until one
            // decrypts the file: legacy RSA first (fast path
            // for the profile that registered the keys — the
            // behavior that predates per-device keys), then the
            // per-device Signal envelope (multi-device).
            const candidates = [];

            if (wrappedKey) {

                candidates.push(async () => {

                    const rawKey =
                        await unwrapFileKey(
                            wrappedKey,
                            await getPrivateKey()
                        );

                    blob =
                        await decryptFile(
                            blob,
                            rawKey,
                            base64ToArrayBuffer(nonce)
                        );

                });

            }

            if (message && wrappedKeys?.length) {

                const meta =
                    await signalKeyStore.getMeta();

                const entry =
                    wrappedKeys.find(
                        item =>
                            item.device_id ===
                            meta?.deviceId
                    );

                if (entry) {

                    candidates.push(async () => {

                        const unwrapped =
                            await decryptEnvelopeBytes({
                                conversationId:
                                    message.conversation_id,
                                envelopeJson:
                                    entry.data,
                            });

                        blob =
                            await decryptFile(
                                blob,
                                new Uint8Array(
                                    unwrapped
                                ),
                                base64ToArrayBuffer(nonce)
                            );

                    });

                }

            }

            for (const candidate of candidates) {

                try {

                    await candidate();

                    blobCache.set(cachedKey, blob);

                    // Share with the account: every browser can
                    // read this file once it unlocks the sync
                    // secret. Fire-and-forget.
                    if (!syncBlob) {

                        void this._ensureSyncBlob(id, blob);

                    }

                    return blob;

                }
                catch (error) {

                    lastError = error;

                }

            }

            // -------------------------------------------------
            // Every device-key candidate failed — the account-key
            // copy (if any) still lets this browser read the file.
            // -------------------------------------------------

            if (
                syncBlob?.nonce &&
                syncBlob?.data &&
                (await signalKeyStore.getSyncSecret())
            ) {

                const raw =
                    await decryptSyncBytes(syncBlob);

                if (raw) {

                    const recovered = new Blob(
                        [raw],
                        { type: blob.type },
                    );

                    blobCache.set(cachedKey, recovered);

                    return recovered;

                }

            }

            // All candidates failed: mark the attachment so the
            // next mount throws fast instead of re-downloading
            // and re-decrypting it. Logged at debug level — the
            // MessageBubble placeholder already tells the user.
            const failed = failedCache.get(deviceId) ?? new Set();

            failed.add(id);

            failedCache.set(deviceId, failed);

            logger.debug(
                "[ATT-DECRYPT] attachment",
                id,
                "cannot be decrypted with the current device keys"
                + " (stale session or re-registered keys).",
                lastError?.message ?? lastError
            );

            throw new AttachmentDecryptError(
                "Attachment cannot be decrypted on this device "
                + "(its keys are no longer available).",
                lastError
            );

        }

        return blob;

    },

    // ==========================================================
    // Share a successfully decrypted file with the account
    //
    // Re-encrypts the raw bytes with the account sync secret and
    // stores the copy server-side, so browsers that register
    // later can read the file after unlocking the recovery code.
    // Fire-and-forget: failure only means the copy is missing.
    // ==========================================================

    async _ensureSyncBlob(id, blob) {

        try {

            if (!(await signalKeyStore.getSyncSecret())) return;

            const bytes = new Uint8Array(
                await blob.arrayBuffer()
            );

            const envelope =
                await encryptSyncBytes(bytes);

            if (!envelope) return;

            await api.put(
                `/attachments/${id}/sync-blob`,
                {
                    sync_copy: envelope,
                }
            );

        }
        catch (error) {

            logger.debug(
                "[SYNC-BLOB] write failed",
                id,
                error
            );

        }

    },

};

export default attachmentService;