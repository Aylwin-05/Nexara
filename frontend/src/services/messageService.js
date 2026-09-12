import api from "../api/api";

const messageService = {

    // ======================================================
    // Get Messages
    // ======================================================

    async getMessages(conversationId, { limit = 50, before = null } = {}) {

        const response = await api.get(
            `/messages/${conversationId}`,
            {
                params: {
                    limit,
                    ...(before ? { before } : {}),
                },
            }
        );

        return response.data;

    },

    // ======================================================
    // Send Encrypted Message
    //
    // Signal mode: ciphertext carries the envelope JSON;
    // legacy RSA fields receive placeholders so the backend
    // schema stays untouched.
    // ======================================================

    async sendMessage(
        conversationId,
        encrypted,
        replyToId = null,
        isForwarded = false,
        forwardedCount = 0,
    ) {

        // One key per send attempt, sent as client_message_id. The
        // API retry interceptor replays the exact same body (and
        // key) on a network failure, so the server dedupes instead
        // of inserting a duplicate.
        const clientMessageId =
            crypto.randomUUID();

        const response =
            await api.post(

                "/messages/send",

                {

                    conversation_id:
                        conversationId,

                    client_message_id:
                        clientMessageId,

                    ciphertext:
                        encrypted.ciphertext,

                    encrypted_key_sender:
                        encrypted.encrypted_key_sender ||
                        "signal",

                    encrypted_key_receiver:
                        encrypted.encrypted_key_receiver ||
                        "signal",

                    nonce:
                        encrypted.nonce ||
                        "signal",

                    message_type:
                        encrypted.message_type ||
                        "text",

                    reply_to_id:
                        replyToId,

                    is_forwarded:
                        isForwarded,

                    forwarded_count:
                        forwardedCount,

                    recipient_keys:
                        encrypted.recipient_keys || [],

                    envelopes:
                        encrypted.envelopes || [],

                }

            );

        return response.data;

    },

    // ======================================================
    // Edit Message (end-to-end encrypted)
    //
    // The edited plaintext is re-encrypted client-side; the
    // server only stores the new ciphertext + wrapped keys.
    // ======================================================

    async editMessage(messageId, encrypted) {

        const response =
            await api.put(

                `/messages/${messageId}/edit`,

                {

                    ciphertext:
                        encrypted.ciphertext,

                    encrypted_key_sender:
                        encrypted.encrypted_key_sender ||
                        "signal",

                    encrypted_key_receiver:
                        encrypted.encrypted_key_receiver ||
                        "signal",

                    nonce:
                        encrypted.nonce ||
                        "signal",

                    recipient_keys:
                        encrypted.recipient_keys || [],

                    envelopes:
                        encrypted.envelopes || [],

                }

            );

        return response.data;

    },

    // ======================================================
    // Upsert Sync Envelope (cross-browser history)
    //
    // Stores the account-key copy of a message's plaintext so
    // browsers that register later can read it after unlocking
    // the sync secret. Opaque to the server.
    // ======================================================

    async saveSyncEnvelope(messageId, envelope) {

        const response =
            await api.put(
                `/messages/${messageId}/sync-envelope`,
                {
                    sync_copy: envelope,
                }
            );

        return response.data;

    },

    // ======================================================
    // Toggle Emoji Reaction
    //
    // Same emoji again removes it; a different emoji replaces
    // it (WhatsApp behaviour).
    // ======================================================

    async toggleReaction(messageId, emoji) {

        const response =
            await api.put(

                `/messages/${messageId}/reaction`,

                {
                    emoji,
                }

            );

        return response.data;

    },

    // ======================================================
    // Delete For Everyone (sender only)
    // ======================================================

    async deleteForEveryone(messageId) {

        const response =
            await api.delete(
                `/messages/${messageId}`
            );

        return response.data;

    },

    // ======================================================
    // Star / Unstar Message (per-user, personal)
    // ======================================================

    async toggleStar(messageId, starred) {

        const response =
            await api.put(
                `/messages/${messageId}/star`,
                {
                    starred,
                }
            );

        return response.data;

    },

    // ======================================================
    // View-once media: recipient reports it as opened
    // ======================================================

    async markViewOnceOpened(messageId) {

        const response =
            await api.post(
                `/messages/${messageId}/view-once-opened`
            );

        return response.data;

    },

    // ======================================================
    // Get Starred Messages (optionally per conversation)
    // ======================================================

    async getStarredMessages(conversationId) {

        const response =
            await api.get(
                "/messages/starred",
                {
                    params: conversationId
                        ? { conversation_id: conversationId }
                        : {},
                }
            );

        return response.data;

    },

    // ======================================================
    // Delete For Me (any participant)
    // ======================================================

    async deleteForMe(messageId) {

        const response =
            await api.delete(
                `/messages/${messageId}/me`
            );

        return response.data;

    },

    // ======================================================
    // Upload Attachment
    //
    // Client-side encrypted: the file is AES-GCM encrypted in
    // the browser; the file's AES key is RSA-OAEP wrapped for
    // the sender and the recipient, and the wrap + IV are sent
    // as form fields so the backend stores them alongside the
    // ciphertext (the backend never sees plaintext or the key).
    // ======================================================

    async uploadAttachment(
        messageId,
        file,
        encryption = null,
        {
            onProgress = null,
            signal = null,
            viewOnce = false,
        } = {},
    ) {

        const formData = new FormData();

        formData.append(
            "file",
            file
        );

        if (viewOnce) {

            formData.append(
                "view_once",
                "true"
            );

        }

        if (encryption) {

            formData.append(
                "encrypted",
                "true"
            );

            formData.append(
                "encrypted_key_sender",
                encryption.encrypted_key_sender
            );

            formData.append(
                "encrypted_key_receiver",
                encryption.encrypted_key_receiver
            );

            formData.append(
                "nonce",
                encryption.nonce
            );

            if (encryption.wrapped_keys) {

                formData.append(
                    "wrapped_keys",
                    JSON.stringify(
                        encryption.wrapped_keys
                    )
                );

            }

        }

        const response =
            await api.post(

                `/attachments/upload/${messageId}`,

                formData,

                {
                    headers: {
                        "Content-Type":
                            "multipart/form-data",
                    },
                    signal,

                    onUploadProgress: (event) => {

                        if (!onProgress) return;

                        if (!event.total) {

                            onProgress(null);

                            return;

                        }

                        onProgress(
                            Math.round(
                                (event.loaded /
                                    event.total) *
                                100
                            )
                        );

                    },
                }

            );

        return response.data;

    },

};

export default messageService;