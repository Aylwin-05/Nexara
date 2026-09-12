import api from "../api/api";
import { getPrivateKey, getPublicKey } from "../crypto/keyStorage";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../crypto/signal/bytes";
import {
    decryptFile,
    encryptFile,
    unwrapFileKey,
    wrapFileKey,
} from "../utils/fileEncryption";
import friendService from "./friendService";
import keyService from "./keyService";
import { logger } from '../utils/logger.js';

// ==========================================================
// Stories (24h status updates, WhatsApp style)
//
// Media is end-to-end encrypted exactly like attachments: the
// file is AES-GCM encrypted in the browser, the raw AES key is
// RSA-OAEP wrapped for the owner and for every friend, and the
// server only ever stores ciphertext + wrapped keys.
// ==========================================================

const storyService = {

    // ======================================================
    // Upload a new status (E2EE)
    // ======================================================

    async upload({ file, caption, myUserId }) {

        const {
            encryptedFile,
            rawKey,
            iv,
        } = await encryptFile(file);

        const encryptedFileBlob =
            new File(
                [encryptedFile],
                file.name,
                {
                    type: file.type ||
                        "application/octet-stream",
                }
            );

        const myPublicKey = await getPublicKey();

        if (!myPublicKey) {

            throw new Error(
                "End-to-end encryption keys are not set up."
            );

        }

        const encryptedKeySender =
            await wrapFileKey(
                rawKey,
                myPublicKey
            );

        // Wrap the file key for every friend so their clients
        // can unwrap it with their own private key.
        const friends =
            await friendService.getFriends();

        const wrappedKeys = [];

        for (const friendship of friends) {

            const other =
                friendship.sender.id === myUserId
                    ? friendship.receiver
                    : friendship.sender;

            try {

                const { public_key } =
                    await keyService.getPublicKey(
                        other.id
                    );

                if (!public_key) continue;

                wrappedKeys.push({
                    user_id: other.id,
                    wrapped_key:
                        await wrapFileKey(
                            rawKey,
                            public_key
                        ),
                });

            }
            catch (error) {

                logger.debug(
                    "[STORY-KEYS] skipping",
                    other.id,
                    error
                );

            }

        }

        const formData = new FormData();

        formData.append("file", encryptedFileBlob);

        formData.append("caption", caption || "");

        formData.append("encrypted", "true");

        formData.append(
            "encrypted_key_sender",
            encryptedKeySender
        );

        formData.append(
            "nonce",
            arrayBufferToBase64(iv)
        );

        formData.append(
            "wrapped_keys",
            JSON.stringify(wrappedKeys)
        );

        const response = await api.post(
            "/stories/",
            formData,
            {
                headers: {
                    "Content-Type":
                        "multipart/form-data",
                },
            }
        );

        return response.data;

    },

    // ======================================================
    // Feed: my stories + my friends' active stories
    // ======================================================

    async getFeed() {

        const response =
            await api.get("/stories/feed");

        return response.data;

    },

    // ======================================================
    // Mark a story as viewed (idempotent)
    // ======================================================

    async markViewed(storyId) {

        const response = await api.post(
            `/stories/${storyId}/view`
        );

        return response.data;

    },

    // ======================================================
    // Delete my story (owner only)
    // ======================================================

    async deleteStory(storyId) {

        const response = await api.delete(
            `/stories/${storyId}`
        );

        return response.data;

    },

    // ======================================================
    // Download + decrypt a story's media
    //
    // Own stories use the legacy RSA self-wrap; friends'
    // stories use the wrapped_key made for MY public key.
    // ======================================================

    async getMedia(story, myUserId) {

        const response = await api.get(
            `/stories/${story.id}/media`,
            {
                responseType: "blob",
            }
        );

        let blob = response.data;

        const nonce =
            story.nonce
                ? base64ToArrayBuffer(story.nonce)
                : null;

        let wrappedKey = null;

        if (story.user_id === myUserId) {

            wrappedKey =
                story.encrypted_key_sender;

        }
        else if (story.wrapped_keys?.length) {

            const entry =
                story.wrapped_keys.find(
                    item => item.user_id === myUserId
                );

            wrappedKey = entry?.wrapped_key ?? null;

        }

        if (
            wrappedKey &&
            nonce &&
            story.encrypted
        ) {

            const rawKey =
                await unwrapFileKey(
                    wrappedKey,
                    await getPrivateKey()
                );

            blob = await decryptFile(
                blob,
                rawKey,
                nonce
            );

        }

        return blob;

    },

    // ==========================================================
    // Story Reactions
    // ==========================================================

    async reactToStory(storyId, emoji) {
        const { data } = await api.post(`/stories/${storyId}/react`, {
            emoji,
        });
        return data;
    },

};

export default storyService;