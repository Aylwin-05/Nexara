import {
    useEffect,
    useState,
} from "react";

import { useAuth } from "../context/AuthContext";

import messageService from "../services/messageService";
import conversationService from "../services/conversationService";
import websocketService from "../services/websocketService";
import {
    useChatSocket,
} from "../context/ChatSocketContext";
import attachmentService from "../services/attachmentService";
import deviceService from "../services/deviceService";
import {
    replenishPreKeys,
} from "../services/signalService";
import {
    encryptForDevices,
    encryptBytesForDevices,
    decryptMessage as signalDecryptMessage,
} from "../services/signalChatService";
import {
    signalKeyStore,
} from "../crypto/signal/keyStore";
import {
    encryptFile,
    wrapFileKey,
} from "../utils/fileEncryption";
import { logger } from "../utils/logger";
import keyService from "../services/keyService";
import {
    arrayBufferToBase64,
} from "../crypto/signal/bytes";
import {
    DM_AAD_PREFIX,
    decryptMessage,
} from "../crypto/cryptoService";
import {
    getPrivateKey,
    getPublicKey,
} from "../crypto/keyStorage";
import {
    encryptGroupMessage,
    decryptGroupMessage,
} from "../utils/groupEncryption";
import {
    encryptSyncText,
    decryptSyncText,
} from "../crypto/syncCrypto";
import {
    generateImageThumbnail,
    generateVideoThumbnail,
    getVideoDimensions,
    getImageDimensions,
} from "../utils/thumbnail";

// ==========================================================
// Reaction list updater
//
// One reaction per user per message (WhatsApp-style): a new
// emoji replaces the previous one; toggling the same emoji
// removes it.
// ==========================================================

function applyReaction(message, event) {

    const reactions =
        (message.reactions || []).filter(
            reaction =>
                reaction.user_id !==
                String(event.user_id)
        );

    if (event.action === "add") {

        reactions.push({
            user_id: String(event.user_id),
            emoji: event.emoji,
            created_at: event.created_at ?? null,
        });

    }

    return {
        ...message,
        reactions,
    };

}

export default function useMessages(
    conversation,
    onNewMessage,
) {

    const { user } = useAuth();

    const { subscribe } = useChatSocket();

    const [messages, setMessages] =
        useState([]);

    const [imageUrls, setImageUrls] =
        useState({});

    const [typingUsers, setTypingUsers] =
        useState([]);

    const [loading, setLoading] =
        useState(false);

    const [hasMore, setHasMore] =
        useState(false);

    const [loadingOlder, setLoadingOlder] =
        useState(false);

    const [error, setError] =
        useState(null);

    const [searchQuery, setSearchQuery] =
        useState("");

    const [searchResults, setSearchResults] =
        useState([]);

    const [searching, setSearching] =
        useState(false);

    const [starredList, setStarredList] =
        useState([]);

    const [starredLoading, setStarredLoading] =
        useState(false);

    const isGroup =
        conversation?.conversation_type === "group";

    // Group chats: participants (with public keys) fetched
    // from the backend, needed to wrap message keys at send.
    const [groupDetail, setGroupDetail] =
        useState(null);

    async function refreshGroupDetail() {

        if (!conversation || !isGroup) return;

        try {

            const detail =
                await conversationService.getConversation(
                    conversation.id
                );

            setGroupDetail(detail);

            return detail;

        }
        catch (error) {

            logger.error(
                "Failed to load group detail",
                error
            );

        }

    }

    useEffect(() => {

        if (isGroup) {

            setGroupDetail(null);

            void refreshGroupDetail();

        }
        else {

            setGroupDetail(null);

        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversation?.id]);

    // Group membership always changes through a
    // `conversations_changed` event: re-fetch participants
    // so senders wrap keys for the CURRENT member set.
    useEffect(() => {

        if (!isGroup) return;

        const unsubscribe = subscribe(
            async (event) => {

                if (
                    event.event ===
                    "conversations_changed"
                ) {

                    await refreshGroupDetail();

                }

            }
        );

        return unsubscribe;

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversation?.id]);

    //------------------------------------------------------
    // Account sync copy helpers (cross-browser history)
    //
    // ensureSyncCopy: after THIS device decrypts (or has
    // cached) a message, re-encrypt the plaintext with the
    // account sync secret and store the copy server-side, so
    // browsers that register later can read it too. Idempotent:
    // a copy whose ciphertext matches the message is current.
    //
    // trySyncDecrypt: fallback read path for messages with NO
    // decryptable per-device envelope here (old history on a
    // new browser): read the account-key copy instead.
    //------------------------------------------------------

    async function ensureSyncCopy(message, plaintext, conversationId) {

        try {

            if (!(await signalKeyStore.getSyncSecret())) return;

            if (
                message?.sync_envelope?.ciphertext ===
                message?.ciphertext
            ) return;

            const envelope = await encryptSyncText(
                plaintext,
                message?.ciphertext ?? null,
            );

            if (!envelope) return;

            await messageService.saveSyncEnvelope(
                message.id,
                envelope,
            );

        }
        catch (error) {

            // Best-effort cross-browser copy — a failure here
            // must never surface or break the message flow.

        }

    }

    async function trySyncDecrypt(message, conversationId) {

        try {

            const syncSecret =
                await signalKeyStore.getSyncSecret();

            if (!syncSecret) return null;

            if (!message?.sync_envelope?.data) return null;

            const plaintext =
                await decryptSyncText(message.sync_envelope);

            if (plaintext == null) {

                return null;

            }

            // Remember it locally too, so the next open of this
            // chat is a plain cache hit.
            await signalKeyStore.savePlaintext(
                conversationId,
                message.id,
                plaintext,
                message.ciphertext,
            );

            return plaintext;

        }
        catch (error) {

            return null;

        }

    }

    //------------------------------------------------------
    // Decrypt an incoming message (Signal first, RSA fallback)
    //------------------------------------------------------

    async function decryptIncoming(message) {

        const conversationId =
            message.conversation_id || conversation.id;

        // -------------------------------------------------
        // System messages ("X added Y", "X left the group")
        // are server-generated plaintext metadata — no
        // encryption involved, so skip the whole decrypt path.
        // -------------------------------------------------

        if (message.message_type === "system") {

            return message.ciphertext ?? "";

        }

        // -------------------------------------------------
        // Multi-device: pick the envelope addressed to THIS
        // device. Messages carry one envelope per device of
        // every participant; only our own copy is decryptable
        // here. (Messages sent from another browser of this
        // account have a copy for us too — the sender wraps
        // for all devices.)
        // -------------------------------------------------

        const envelopes = message.envelopes ?? [];

        const meta = await signalKeyStore.getMeta();

        const myDeviceId = meta?.deviceId ?? null;

        const myEnvelope = myDeviceId
            ? envelopes.find(
                (entry) =>
                    entry.device_id === myDeviceId
              )?.data ?? null
            : null;

        // -------------------------------------------------
        // Plaintext cache first. Some envelopes are
        // fundamentally NOT replayable after a reload:
        //  - our own sends (no (me, me) ratchet session)
        //  - the first received handshake, whose one-time
        //    prekey was consumed and deleted on first use
        // So whatever we sent or actually decrypted is kept
        // in the local cache and served from there.
        // -------------------------------------------------

        const cachedRecord =
            await signalKeyStore.getCachedRecord(
                conversationId,
                message.id,
            );

        // The cache is keyed per message id. An EDITED message
        // carries a fresh envelope, so a record whose ciphertext
        // differs from the message's current ciphertext is stale
        // and must be re-decrypted instead of served from cache.
        // Records saved before ciphertext tracking (null) keep
        // matching so old cached history keeps its plaintext.
        if (
            cachedRecord &&
            (
                cachedRecord.ciphertext == null ||
                cachedRecord.ciphertext === message.ciphertext
            )
        ) {

            // Backfill: this browser has the plaintext but the
            // message has no account-key copy yet — share it so
            // every other browser of this account can read it.
            void ensureSyncCopy(
                message,
                cachedRecord.plaintext,
                conversationId,
            );

            return cachedRecord.plaintext;

        }

        let plaintext;

        // -------------------------------------------------
        // Group message: the AES key was wrapped to EVERY
        // member's device; unwrap OUR copy and decrypt.
        // (Determined by conversation type — modern group
        // messages may carry no legacy RSA recipient keys.)
        // -------------------------------------------------

        if (conversation?.conversation_type === "group") {

            // Per-device copies exist but none for THIS device
            // (e.g. history on a device registered later).
            if (envelopes.length && !myEnvelope) {

                // No envelope for THIS device (e.g. history on a
                // device registered later). The account-key copy
                // (if any) still lets us read it.
                const syncPlain =
                    await trySyncDecrypt(
                        message,
                        conversationId,
                    );

                if (syncPlain !== null) return syncPlain;

                try {

                    plaintext =
                        await decryptGroupMessage(
                            message,
                            await getPrivateKey(),
                            user.id,
                            myDeviceId,
                        );

                }
                catch {

                    // Sync copy exists on the server but the
                    // local sync secret doesn't match — the
                    // user needs to unlock history.
                    if (message.sync_envelope?.ciphertext) {

                        return "[Locked — go to Settings > "
                            + "Support > Unlock History]";

                    }

                    return message.sender_id === user.id
                        ? "[Sent from another device]"
                        : "[Encrypted for another device]";

                }

            }

            try {

                plaintext =
                    await decryptGroupMessage(
                        message,
                        await getPrivateKey(),
                        user.id,
                        myDeviceId,
                    );

            }
            catch (error) {

                // Device envelope failed — the account-key copy may
                // still decrypt.
                const syncPlain =
                    await trySyncDecrypt(
                        message,
                        conversationId,
                    );

                if (syncPlain !== null) return syncPlain;

                logger.error(
                    "Failed to decrypt group message:",
                    error
                );

                if (message.sync_envelope?.ciphertext) {

                    return "[Locked — go to Settings > "
                        + "Support > Unlock History]";

                }

                return "[Unable to decrypt]";

            }

        }
        else if (myEnvelope) {

            //--------------------------------------------------
            // DM with a copy addressed to this device
            //--------------------------------------------------

            try {

                plaintext = await signalDecryptMessage({
                    conversationId,
                    senderId: message.sender_id,
                    ciphertext: myEnvelope,
                });

            }
            catch (error) {

                // Session failure — the account-key copy (if any)
                // still lets us read the message.
                const syncPlain =
                    await trySyncDecrypt(
                        message,
                        conversationId,
                    );

                if (syncPlain !== null) return syncPlain;

                logger.error(
                    "Failed to decrypt device envelope:",
                    error
                );

                return "[Unable to decrypt]";

            }

        }
        else if (envelopes.length) {

            //--------------------------------------------------
            // The message has per-device copies but none for
            // THIS device (e.g. old history on a browser that
            // registered after the message was sent). It was
            // never meant to be decryptable here — unless the
            // account-key copy exists, or the pinned envelope
            // in message.ciphertext happens to be decryptable
            // via an existing ratchet session.
            //--------------------------------------------------

            const syncPlain =
                await trySyncDecrypt(
                    message,
                    conversationId,
                );

            if (syncPlain !== null) return syncPlain;

            try {

                plaintext = await signalDecryptMessage({
                    conversationId,
                    ciphertext: message.ciphertext,
                });

            }
            catch {

                if (message.sync_envelope?.ciphertext) {

                    return "[Locked — go to Settings > "
                        + "Support > Unlock History]";

                }

                return message.sender_id === user.id
                    ? "[Sent from another device]"
                    : "[Encrypted for another device]";

            }

        }
        else {

        try {

            // Signal envelope JSON?
            plaintext = await signalDecryptMessage({
                conversationId,
                senderId: message.sender_id,
                ciphertext: message.ciphertext,
            });

        }
        catch {

            // Legacy RSA fallback
            try {

                const encryptedKey =
                    message.sender_id === user.id
                        ? message.encrypted_key_sender
                        : message.encrypted_key_receiver;

                plaintext = await decryptMessage(
                    message.ciphertext,
                    encryptedKey,
                    message.nonce,
                    await getPrivateKey(),
                    DM_AAD_PREFIX + conversationId,
                );

            }
            catch {

                const syncPlain =
                    await trySyncDecrypt(
                        message,
                        conversationId,
                    );

                if (syncPlain !== null) return syncPlain;

                return "[Unable to decrypt]";

            }

        }

        }

        // Decrypted live ΓÇö remember it so a page reload can
        // show it again (the handshake envelope can never be
        // decrypted twice).
        try {

            await signalKeyStore.savePlaintext(
                conversationId,
                message.id,
                plaintext,
                message.ciphertext,
            );

        }
        catch (error) {

            logger.error(
                "Failed to cache received message:",
                error
            );

        }

        // Share with the account: every other browser can read
        // this message once it unlocks the sync secret.
        void ensureSyncCopy(
            message,
            plaintext,
            conversationId,
        );

        return plaintext;

    }

    useEffect(() => {

        if (!conversation) {

            setMessages([]);

            clearSearch();

            return;

        }

        void initialize();

    }, [conversation?.id]);

    // After the sync secret is unlocked (recovery code entered
    // in the modal, Settings, or the /recover page), re-fetch
    // this conversation: the account-key copies now decrypt.
    useEffect(() => {

        if (!conversation) return;

        const onUnlocked = async () => {

            await initialize();

            try {
                const records =
                    await signalKeyStore.getAllCachedRecords();
                for (const record of records) {
                    if (
                        !record.plaintext ||
                        !record.messageId
                    ) continue;
                    try {
                        await ensureSyncCopy(
                            {
                                id: record.messageId,
                                ciphertext:
                                    record.ciphertext,
                            },
                            record.plaintext,
                            record.conversationId,
                        );
                    } catch { /* best effort */ }
                }
            } catch { /* best effort */ }

        };

        window.addEventListener(
            "nexara:sync-unlocked",
            onUnlocked,
        );

        return () =>
            window.removeEventListener(
                "nexara:sync-unlocked",
                onUnlocked,
            );

    }, [conversation?.id]);
    useEffect(() => {

    return () => {

        Object.values(imageUrls).forEach(

            (url) => URL.revokeObjectURL(url)

        );

    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    //------------------------------------------------------
    // Real-time events: the user-scoped socket (ChatSocket
    // provider) delivers every conversation; filter to this
    // one and apply updates without any page refresh.
    //------------------------------------------------------

    useEffect(() => {

        if (!conversation) return;

        const unsubscribe = subscribe(

            async (event) => {

                if (
                    event.conversation_id &&
                    event.conversation_id !== conversation.id
                ) {
                    return;
                }

                                        switch (event.event) {

                        //--------------------------------------------------
                        // Incoming encrypted message
                        //--------------------------------------------------

                        case "message":

                            try {

                            const plaintext =
                                await decryptIncoming(event);

                                const message = {

                                    ...event,

                                    content: plaintext,

                                    attachments:
                                        event.attachments || [],

                                    reactions:
                                        event.reactions || [],

                                };

                                setMessages(
                                    previous => {

                                        const exists =
                                            previous.some(
                                                msg =>
                                                    msg.id ===
                                                    message.id
                                            );

                                        if (exists) {

                                            return previous;

                                        }

                                        return [

                                            ...previous,

                                            message,

                                        ];

                                    }
                                );

                                onNewMessage?.(
                                    message
                                );

                                //------------------------------------------
                                // Read receipts: the chat is open, so the
                                // incoming message is seen instantly.
                                //------------------------------------------

                                if (
                                    event.sender_id !== user?.id
                                ) {

                                    websocketService.sendDelivered(
                                        conversation.id,
                                        message.id
                                    );

                                    websocketService.sendRead(
                                        conversation.id,
                                        message.id
                                    );

                                }

                            }

                            catch (error) {

                                logger.error(
                                    "Decrypt failed",
                                    error
                                );

                            }

                            break;

                        //--------------------------------------------------
                        // Conversation deleted (two-party wipe)
                        //--------------------------------------------------

                        case "conversation_deleted":

                            setMessages([]);

                            clearSearch();

                            break;

                        //--------------------------------------------------
                        // Typing
                        //--------------------------------------------------

                        case "typing":

                            if (
                                event.user_id !==
                                user?.id
                            ) {

                                setTypingUsers(
                                    previous => {

                                        if (
                                            previous.includes(
                                                event.user_id
                                            )
                                        ) {

                                            return previous;

                                        }

                                        return [

                                            ...previous,

                                            event.user_id,

                                        ];

                                    }
                                );

                            }

                            break;

                        //--------------------------------------------------
                        // Stop Typing
                        //--------------------------------------------------

                        case "stop_typing":

                            setTypingUsers(
                                previous =>

                                    previous.filter(
                                        id =>
                                            id !==
                                            event.user_id
                                    )

                            );

                            break;

                        //--------------------------------------------------
                        // Edit
                        //--------------------------------------------------

                        case "edit":

                            setMessages(
                                previous =>

                                    previous.map(
                                        message =>

                                            message.id ===
                                            event.message_id

                                                ? {

                                                    ...message,

                                                    edited: true,

                                                    updated_at:
                                                        event.updated_at,

                                                    ciphertext:
                                                        event.ciphertext ??
                                                        message.ciphertext,

                                                    encrypted_key_sender:
                                                        event.encrypted_key_sender ??
                                                        message.encrypted_key_sender,

                                                    encrypted_key_receiver:
                                                        event.encrypted_key_receiver ??
                                                        message.encrypted_key_receiver,

                                                    nonce:
                                                        event.nonce ??
                                                        message.nonce,

                                                    recipient_keys:
                                                        event.recipient_keys ??
                                                        message.recipient_keys ??
                                                        [],

                                                    envelopes:
                                                        event.envelopes ??
                                                        message.envelopes ??
                                                        [],

                                                    sync_envelope:
                                                        event.sync_envelope ??
                                                        message.sync_envelope,

                                                }

                                                : message

                                    )

                            );

                            //-----------------------------------------------
                            // The edited content is a fresh ratchet
                            // envelope: try to decrypt it (receivers can,
                            // senders hit the plaintext cache).
                            //-----------------------------------------------

                            if (event.ciphertext) {

                                try {

                                    const updatedPlaintext =
                                        await decryptIncoming({

                                            id:
                                                event.message_id,

                                            conversation_id:
                                                conversation.id,

                                            sender_id:
                                                event.sender_id,

                                            ciphertext:
                                                event.ciphertext,

                                            encrypted_key_sender:
                                                event.encrypted_key_sender,

                                            encrypted_key_receiver:
                                                event.encrypted_key_receiver,

                                            nonce:
                                                event.nonce,

                                            recipient_keys:
                                                event.recipient_keys ?? [],

                                            envelopes:
                                                event.envelopes ?? [],

                                            sync_envelope:
                                                event.sync_envelope ?? null,

                                        });

                                    if (
                                        updatedPlaintext &&
                                        updatedPlaintext !==
                                            "[Unable to decrypt]" &&
                                        updatedPlaintext !==
                                            "[Sent from another device]" &&
                                        updatedPlaintext !==
                                            "[Encrypted for another device]"
                                    ) {

                                        setMessages(
                                            previous =>

                                                previous.map(
                                                    message =>

                                                        message.id ===
                                                        event.message_id

                                                            ? {

                                                                ...message,

                                                                content:
                                                                    updatedPlaintext,

                                                            }

                                                            : message

                                                )

                                        );

                                    }

                                }

                                catch (error) {

                                    logger.error(
                                        "Edit decrypt failed",
                                        error
                                    );

                                }

                            }

                            break;

                        //--------------------------------------------------
                        // Reaction
                        //--------------------------------------------------

                        case "reaction":

                            setMessages(
                                previous =>

                                    previous.map(
                                        message =>

                                            message.id !==
                                            event.message_id

                                                ? message

                                                : applyReaction(
                                                    message,
                                                    event
                                                )

                                    )

                            );

                            break;

                        //--------------------------------------------------
                        // View-once media opened
                        //--------------------------------------------------

                        case "view_once_opened":

                            setMessages(
                                previous =>

                                    previous.map(
                                        message =>

                                            message.id ===
                                            event.message_id

                                                ? {
                                                    ...message,
                                                    view_once_opened: true,
                                                    attachments: (
                                                        message.attachments || []
                                                    ).map(attachment => ({
                                                        ...attachment,
                                                        view_once_opened: true,
                                                    })),
                                                }

                                                : message
                                    )
                            );

                            break;

                        //--------------------------------------------------
                        // Delete
                        //--------------------------------------------------

                        case "delete":

                            setMessages(
                                previous =>

                                    previous.map(
                                        message =>

                                            message.id ===
                                            event.message_id

                                                ? {

                                                    ...message,

                                                    deleted_for_everyone: true,

                                                    content:
                                                        "≡ƒÜ½ Message deleted",

                                                }

                                                : message

                                    )

                            );

                            break;

                        //--------------------------------------------------
                        // Delivered
                        //--------------------------------------------------

                        case "delivered":

                            setMessages(
                                previous =>

                                    previous.map(
                                        message =>

                                            message.id ===
                                            event.message_id

                                                ? {

                                                    ...message,

                                                    delivered_at:
                                                        event.delivered_at,

                                                }

                                                : message

                                    )

                            );

                            break;

                        //--------------------------------------------------
                        // Read
                        //--------------------------------------------------

                        case "read":

                            setMessages(
                                previous =>

                                    previous.map(
                                        message =>

                                            message.id ===
                                            event.message_id

                                                ? {

                                                    ...message,

                                                    is_read: true,

                                                    read_at:
                                                        event.read_at,

                                                }

                                                : message

                                    )

                            );

                            break;

                            case "attachment":

                            if (
                                event.attachment?.attachment_type ===
                                    "image" &&
                                !event.attachment.view_once
                            ) {

                                // View-once media is excluded: on
                                // recipients it must only download
                                // when they tap to open; the sender's
                                // own bubble preloads it instead.

try {

                            const imageBlob =
                                await attachmentService.getAttachment(
                                    event.attachment.id,
                                    {
                                        wrappedKey:
                                            String(event.sender_id) === String(user?.id)
                                                ? event.attachment.encrypted_key_sender
                                                : event.attachment.encrypted_key_receiver,

                                        nonce:
                                            event.attachment.nonce,

                                        wrappedKeys:
                                            event.attachment.wrapped_keys,

                                        message: event,
                                    }
                                );

                            const imageUrl = URL.createObjectURL(imageBlob);

                            setImageUrls(previous => ({

                                ...previous,

                                [event.attachment.id]:
                                    imageUrl,

                            }));

                        }

                                catch (error) {

                                    logger.error(error);

                                }

                            }

                            setMessages(previous =>

                                previous.map(message =>

                                    message.id ===
                                    event.message_id

                                        ? {

                                            ...message,

                                            attachments: [

                                                ...(message.attachments || []).filter(
                                                    attachment =>
                                                        attachment.id !==
                                                        event.attachment.id
                                                ),

                                                event.attachment,

                                            ],

                                        }

                                        : message

                                )

                            );

                            break;

                            //--------------------------------------------------
                            // Attachment Deleted
                            //--------------------------------------------------

                            case "attachment_deleted":

                                setMessages(previous =>

                                    previous.map(message =>

                                        message.id === event.message_id

                                            ? {

                                                ...message,

                                                attachments:

                                                    (message.attachments || []).filter(

                                                        attachment =>

                                                            attachment.id !== event.attachment_id

                                                    ),

                                            }

                                            : message

                                    )

                                );

                                break;

                        default:

                            break;

                    }
            }

        );

        return unsubscribe;

    }, [conversation?.id]);

    //------------------------------------------------------
    // Disappearing messages: drop messages locally when their
    // server-side expiry time arrives (the server also purges
    // the ciphertext on any read, so this is purely visual).
    //------------------------------------------------------

    useEffect(() => {

        if (!messages.length) return;

        const timers = [];

        for (const message of messages) {

            if (!message.expires_at) continue;

            const delay =
                new Date(message.expires_at) -
                Date.now();

            if (delay <= 0) {

                setMessages(previous =>
                    previous.filter(m =>
                        m.id !== message.id
                    )
                );

                continue;

            }

            timers.push(
                setTimeout(() => {

                    setMessages(previous =>
                        previous.filter(m =>
                            m.id !== message.id
                        )
                    );

                }, delay)
            );

        }

        return () => {
            timers.forEach(clearTimeout);
        };

    }, [messages]);

    //------------------------------------------------------
    // Search messages (client-side over decrypted plaintext).
    //
    // The backend can never match plaintext (it only stores
    // ciphertext), so the search fetches the conversation
    // history, decrypts each message through the Signal
    // session / plaintext cache, and filters locally. E2EE
    // means the search itself never leaves the device.
    //------------------------------------------------------

    async function searchMessages(query) {

        if (!query.trim()) {

            setSearchResults([]);

            setSearchQuery("");

            return;

        }

        setSearchQuery(query);

        setSearching(true);

        try {

            const history =
                await messageService.getMessages(
                    conversation.id
                );

            const needle =
                query.trim().toLowerCase();

            const matches = [];

            for (const message of history) {

                const plaintext =
                    await decryptIncoming(message);

                const haystack =
                    (plaintext ?? "").toLowerCase();

                if (haystack.includes(needle)) {

                    matches.push({
                        id: message.id,
                        content: plaintext,
                        created_at:
                            message.created_at,
                        sender_id:
                            message.sender_id,
                        message_type:
                            message.message_type,
                    });

                }

            }

            setSearchResults(matches);

        }
        catch (error) {

            logger.error(
                "Search failed",
                error
            );

            setSearchResults([]);

            setError(error);

        }
        finally {

            setSearching(false);

        }

    }

    //------------------------------------------------------
    // Clear search state (switching chats, closing the bar)
    //------------------------------------------------------

    function clearSearch() {

        setSearchQuery("");

        setSearchResults([]);

    }

    async function initialize() {

        try {

            setLoading(true);

            //--------------------------------------------------
            // Load encrypted history
            //--------------------------------------------------

            const history =
                await messageService.getMessages(
                    conversation.id,
                    { limit: 50 }
                );

            setHasMore(history.length === 50);

            //--------------------------------------------------
            // Decrypt every message
            //--------------------------------------------------

            const decrypted =
                await Promise.all(

                    history.map(
                        async (message) => {

                            try {

                                const plaintext =
                                    await decryptIncoming(message);

                                return {

                                    ...message,

                                    content:
                                        plaintext,

                                };

                            }

                            catch {

                                return {

                                    ...message,

                                    content:
                                        "[Unable to decrypt]",

                                };

                            }

                        }

                    )

                );

            setMessages(decrypted);

            //--------------------------------------------------
            // Read receipts: opening a chat reads its history
            //--------------------------------------------------

            const latestIncoming =
                decrypted
                    .filter(
                        message =>
                            message.sender_id !== user?.id &&
                            !message.is_read
                    )
                    .sort(
                        (a, b) =>
                            new Date(a.created_at) -
                            new Date(b.created_at)
                    )
                    .pop();

            if (latestIncoming) {

                websocketService.sendRead(
                    conversation.id,
                    latestIncoming.id
                );

            }

            //--------------------------------------------------
            // Download all image attachments
            //--------------------------------------------------

            for (const message of decrypted) {

                if (!message.attachments?.length) {

                    continue;

                }

                for (const attachment of message.attachments) {

                    // View-once media is never auto-fetched — not
                    // even the sender's own copy (WhatsApp-style:
                    // no preview anywhere). Recipients fetch only
                    // on tap, and closing deletes it server-side.
                    if (attachment.view_once) {

                        continue;

                    }

                    if (
                        attachment.attachment_type ===
                        "image"
                    ) {

                        try {

                            const imageBlob =
                                await attachmentService.getAttachment(
                                    attachment.id,
                                    {
                                        wrappedKey:
                                            String(message.sender_id) === String(user?.id)
                                                ? attachment.encrypted_key_sender
                                                : attachment.encrypted_key_receiver,

                                        nonce:
                                            attachment.nonce,

                                        wrappedKeys:
                                            attachment.wrapped_keys,

                                        message,
                                    }
                                );

                            const imageUrl = URL.createObjectURL(imageBlob);

                            setImageUrls(previous => ({

                                ...previous,

                                [attachment.id]:
                                    imageUrl,

                            }));

                        }

                        catch (error) {

                            if (
                                error?.name ===
                                "AttachmentDecryptError"
                            ) {

                                // Keys for this attachment are
                                // gone on this device; the
                                // bubble renders a placeholder.
                                continue;

                            }

                            logger.error(
                                "Image download failed",
                                error
                            );

                        }

                    }

                }

            }


        }

        catch (err) {

            logger.error(err);

            setError(err);

        }

        finally {

            setLoading(false);

        }

    }

    //------------------------------------------------------
    // Load older messages (scroll-to-top pagination)
    //------------------------------------------------------

    async function loadOlder() {

        if (!hasMore || loadingOlder || loading) return;

        const oldest = messages[0];

        if (!oldest) return;

        setLoadingOlder(true);

        try {

            const history =
                await messageService.getMessages(
                    conversation.id,
                    {
                        limit: 50,
                        before: oldest.id,
                    }
                );

            const decrypted =
                await Promise.all(
                    history.map(
                        async (message) => {

                            try {

                                const plaintext =
                                    await decryptIncoming(message);

                                return {

                                    ...message,

                                    content: plaintext,

                                };

                            }

                            catch {

                                return {

                                    ...message,

                                    content:
                                        "[Unable to decrypt]",

                                };

                            }

                        }
                    )
                );

            if (decrypted.length) {

                setMessages(previous => {

                    const existing = new Set(
                        previous.map(message => message.id)
                    );

                    return [
                        ...decrypted.filter(
                            message => !existing.has(message.id)
                        ),
                        ...previous,
                    ];

                });

            }

            setHasMore(history.length === 50);

        }

        catch (err) {

            logger.error(err);

        }

        finally {

            setLoadingOlder(false);

        }

    }

    //------------------------------------------------------
    // Generate + upload thumbnail + media metadata
    //
    // Called after an image/video attachment uploads. Runs
    // client-side (the server only sees ciphertext) and is
    // best-effort: a failure never blocks the message flow.
    //------------------------------------------------------

    async function uploadMediaMeta(originalFile, attachmentId, isViewOnce) {
        try {
            if (
                originalFile.type.startsWith("image/") &&
                !isViewOnce
            ) {
                const dims = await getImageDimensions(originalFile);
                const thumb = await generateImageThumbnail(originalFile);
                if (thumb && attachmentId) {
                    await attachmentService.uploadThumbnail(
                        attachmentId,
                        thumb,
                        {
                            width: dims?.width ?? null,
                            height: dims?.height ?? null,
                        },
                    );
                }
            } else if (
                originalFile.type.startsWith("video/") &&
                !isViewOnce
            ) {
                const dims = await getVideoDimensions(originalFile);
                const thumb = await generateVideoThumbnail(originalFile);
                if (thumb && attachmentId) {
                    await attachmentService.uploadThumbnail(
                        attachmentId,
                        thumb,
                        {
                            width: dims?.width ?? null,
                            height: dims?.height ?? null,
                            duration: dims?.duration ?? null,
                        },
                    );
                }
            }
        } catch (error) {
            logger.debug("[THUMB] upload failed", error);
        }
    }

        //--------------------------------------------------
    // Send Encrypted Message
    //--------------------------------------------------

    async function sendMessage(
        plaintext,
        file = null,
        options = {},
    )
    {

        const {
            replyToId = null,
            isForwarded = false,
            onProgress = null,
            signal = null,
            holdUntil = 0,
            viewOnce = false,
        } = options;

        // Hoisted so the catch block can clean up an orphaned
        // backend message when an upload is cancelled.
        let savedMessage = null;

        try {

            //--------------------------------------------------
            // Group chats: fresh AES key wrapped to every
            // member's public key (E2EE for N recipients).
            //--------------------------------------------------

            if (isGroup) {

                if (!groupDetail?.participants?.length) {

                    throw new Error(
                        "Group members are still loading. "
                        + "Try again in a moment."
                    );

                }

                // Members actually used for wrapping — kept so a
                // following attachment wraps its key for exactly
                // the same audience as the message text.
                let members = groupDetail.participants;

                // Encrypt with the CURRENT membership; if the
                // server rejects because a member changed since
                // this view was loaded, refresh and re-encrypt
                // once (never wrap keys for a removed member).
                let saved;

                try {

                    const encrypted =
                        await encryptGroupMessage(
                            plaintext,
                            members,
                            conversation.id,
                        );

                    saved =
                        await messageService.sendMessage(
                            conversation.id,
                            encrypted,
                            replyToId,
                            isForwarded,
                        );

                }
                catch (error) {

                    const detail =
                        error?.response?.data?.detail;

                    if (
                        typeof detail === "string" &&
                        detail.includes(
                            "Group membership changed"
                        )
                    ) {

                        const fresh =
                            await refreshGroupDetail();

                        members =
                            fresh?.participants ??
                            groupDetail.participants;

                        const encrypted =
                            await encryptGroupMessage(
                                plaintext,
                                members,
                                conversation.id,
                            );

                        saved =
                            await messageService.sendMessage(
                                conversation.id,
                                encrypted,
                                replyToId,
                                isForwarded,
                            );

                    }
                    else {

                        throw error;

                    }

                }

                //--------------------------------------------------
                // Group attachment E2EE: AES-encrypt the file in
                // the browser, then deliver its key per DEVICE as
                // Signal envelopes for every member's devices —
                // the same channel the group text itself uses.
                // The single-receiver RSA columns carry only a
                // placeholder (a group has no single receiver).
                //--------------------------------------------------

                let uploaded = null;

                if (file) {

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
                                type:
                                    file.type ||
                                    "application/octet-stream",
                            }
                        );

                    const memberBundles =
                        await Promise.all(
                            members.map(member =>
                                deviceService
                                    .getBundle(member.user_id)
                                    .catch(() => null)
                            )
                        );

                    const allDevices =
                        memberBundles.flatMap(
                            bundle =>
                                bundle?.devices ?? []
                        );

                    const wrappedKeys =
                        await encryptBytesForDevices({
                            conversationId:
                                conversation.id,
                            bytes:
                                new Uint8Array(rawKey),
                            devices: allDevices,
                        });

                    uploaded =
                        await messageService.uploadAttachment(
                            saved.id,
                            encryptedFileBlob,
                            {
                                encrypted_key_sender:
                                    "signal",

                                encrypted_key_receiver:
                                    "signal",

                                nonce:
                                    arrayBufferToBase64(iv),

                                wrapped_keys:
                                    wrappedKeys,
                            },
                            {
                                onProgress,
                                signal,
                                viewOnce,
                            }
                        );

                    onProgress?.(100);

                    void uploadMediaMeta(
                        file,
                        uploaded.attachment.id,
                        viewOnce,
                    );

                }

                const localMessage = {
                    ...saved,
                    content: plaintext,
                    attachments:
                        file && uploaded
                            ? [uploaded.attachment]
                            : [],
                };

                setMessages(previous => [
                    ...previous,
                    localMessage,
                ]);

                onNewMessage?.(localMessage);

                try {

                    await signalKeyStore.savePlaintext(
                        conversation.id,
                        saved.id,
                        plaintext,
                        saved.ciphertext,
                    );

                    void ensureSyncCopy(
                        saved,
                        plaintext,
                        conversation.id,
                    );

                }
                catch (error) {

                    logger.error(
                        "Failed to cache sent message:",
                        error
                    );

                }

                websocketService.sendMessage({
                    id: saved.id,
                    conversation_id: saved.conversation_id,
                    sender_id: saved.sender_id,
                    ciphertext: saved.ciphertext,
                    encrypted_key_sender: saved.encrypted_key_sender,
                    encrypted_key_receiver: saved.encrypted_key_receiver,
                    nonce: saved.nonce,
                    crypto_version: saved.crypto_version,
                    message_type: saved.message_type,
                    reply_to_id: saved.reply_to_id,
                    is_forwarded: saved.is_forwarded,
                    forwarded_count: saved.forwarded_count,
                    expires_at: saved.expires_at,
                    created_at: saved.created_at,
                    attachments: localMessage.attachments,
                    recipient_keys: saved.recipient_keys ?? [],
                    envelopes: saved.envelopes ?? [],
                });

                setError(null);

                return;

            }

            //--------------------------------------------------
            // Encrypt for EVERY device of both users (Signal
            // ratchet): one envelope per device, so this
            // account's other browsers can decrypt the echo.
            //--------------------------------------------------

            const [peerBundle, myBundle] = await Promise.all([
                deviceService.getBundle(
                    conversation.other_user.id
                ),
                deviceService.getBundle(
                    user.id
                ),
            ]);

            const allDevices = [
                ...(peerBundle?.devices ?? []),
                ...(myBundle?.devices ?? []),
            ];

            const encrypted =
                await encryptForDevices({
                    conversationId: conversation.id,
                    plaintext,
                    devices: allDevices,
                });

            // Message send in progress

            savedMessage =
                await messageService.sendMessage(
                    conversation.id,
                    encrypted,
                    replyToId,
                    isForwarded,
                );

            //--------------------------------------------------
            // Encrypt + upload attachment (if any)
            //--------------------------------------------------

            let uploaded = null;

            if (file) {

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
                            type:
                                file.type ||
                                "application/octet-stream",
                        }
                    );

                const myPublicKey =
                    await getPublicKey();

                const theirPublicKey =
                    (
                        await keyService.getPublicKey(
                            conversation.other_user.id
                        )
                    )?.public_key;

                if (
                    !myPublicKey ||
                    !theirPublicKey
                ) {

                    throw new Error(
                        "End-to-end encryption keys are not set up."
                    );

                }

                const [
                    encryptedKeySender,
                    encryptedKeyReceiver,
                ] = await Promise.all([
                    wrapFileKey(rawKey, myPublicKey),
                    wrapFileKey(
                        rawKey,
                        theirPublicKey
                    ),
                ]);

                // Per-device Signal envelopes of the file's AES
                // key: every recipient device can unwrap its own
                // copy (this sender's device is skipped — no
                // (me, me) ratchet — and keeps using the RSA
                // self-wrap above).
                const wrappedKeys =
                    await encryptBytesForDevices({
                        conversationId:
                            conversation.id,
                        bytes:
                            new Uint8Array(rawKey),
                        devices: allDevices,
                    });

                uploaded =
                    await messageService.uploadAttachment(
                        savedMessage.id,
                        encryptedFileBlob,
                        {
                            encrypted_key_sender:
                                encryptedKeySender,

                            encrypted_key_receiver:
                                encryptedKeyReceiver,

                            nonce:
                                arrayBufferToBase64(iv),

                            wrapped_keys:
                                wrappedKeys,
                        },
                        {
                            onProgress,
                            signal,
                            viewOnce,
                        }
                    );

                onProgress?.(100);

                void uploadMediaMeta(
                    file,
                    uploaded.attachment.id,
                    viewOnce,
                );

            }

            //--------------------------------------------------
            // Optimistic UI + plaintext cache + realtime
            //--------------------------------------------------

            const localMessage = {
                ...savedMessage,
                content: plaintext,
                attachments:
                    file && uploaded
                        ? [uploaded.attachment]
                        : [],
            };

            setMessages(previous => [
                ...previous,
                localMessage,
            ]);

            onNewMessage?.(localMessage);

            try {

                await signalKeyStore.savePlaintext(
                    conversation.id,
                    savedMessage.id,
                    plaintext,
                    savedMessage.ciphertext,
                );

                void ensureSyncCopy(
                    savedMessage,
                    plaintext,
                    conversation.id,
                );

            }
            catch (error) {

                logger.error(
                    "Failed to cache sent message:",
                    error
                );

            }

            const relayPayload = {
                id: savedMessage.id,
                conversation_id: savedMessage.conversation_id,
                sender_id: savedMessage.sender_id,
                ciphertext: savedMessage.ciphertext,
                encrypted_key_sender: savedMessage.encrypted_key_sender,
                encrypted_key_receiver: savedMessage.encrypted_key_receiver,
                nonce: savedMessage.nonce,
                crypto_version: savedMessage.crypto_version,
                message_type: savedMessage.message_type,
                reply_to_id: savedMessage.reply_to_id,
                is_forwarded: savedMessage.is_forwarded,
                forwarded_count: savedMessage.forwarded_count,
                expires_at: savedMessage.expires_at,
                created_at: savedMessage.created_at,
                attachments: localMessage.attachments,
                recipient_keys: savedMessage.recipient_keys ?? [],
                envelopes: savedMessage.envelopes ?? [],
            };

            //--------------------------------------------------
            // Hold before relaying: the "Sent" panel stays on
            // screen at least until holdUntil, and the message
            // only reaches the peer once the hold ends. Cancel
            // during the hold aborts the send entirely (the
            // orphan message is removed in the catch block).
            // Text sends have no panel and relay immediately.
            //--------------------------------------------------

            if (file && holdUntil > 0) {

                const holdMs =
                    Math.max(
                        0,
                        holdUntil - Date.now()
                    );

                if (!signal?.aborted) {

                    await new Promise(
                        resolve => {

                            const onAbort =
                                () => {

                                    clearTimeout(
                                        timer
                                    );

                                    resolve();

                                };

                            signal?.addEventListener(
                                "abort",
                                onAbort,
                                { once: true },
                            );

                            const timer =
                                setTimeout(() => {

                                    signal?.removeEventListener(
                                        "abort",
                                        onAbort
                                    );

                                    resolve();

                                }, holdMs);

                        }
                    );

                }

                if (signal?.aborted) {

                    await messageService.deleteForEveryone(
                        savedMessage.id
                    );

                    const cancelError =
                        new Error(
                            "Upload cancelled"
                        );

                    cancelError.code = "ERR_CANCELED";

                    throw cancelError;

                }

            }

            websocketService.sendMessage(relayPayload);

            setError(null);

            // Replenish one-time prekeys in the background
            replenishPreKeys().catch(
                error => logger.error(
                    "One-time prekey replenishment failed:",
                    error
                )
            );

        }

        catch (error) {

            //--------------------------------------------------
            // User cancelled an attachment upload: the backend
            // message was created before the upload, so remove
            // that orphan so the peer never sees an empty
            // message. No error banner — cancellation is not
            // an error.
            //--------------------------------------------------

            if (error?.code === "ERR_CANCELED") {

                // Drop the optimistic bubble the send flow may
                // have added before the hold phase.
                if (savedMessage?.id) {

                    setMessages(previous =>
                        previous.filter(
                            message =>
                                message.id !==
                                savedMessage.id
                        )
                    );

                }

                try {

                    if (savedMessage?.id) {

                        await messageService.deleteForEveryone(
                            savedMessage.id
                        );

                    }

                }
                catch (cleanupError) {

                    logger.error(
                        "Failed to remove cancelled "
                        + "attachment message:",
                        cleanupError
                    );

                }

                // Let the caller (ChatInput) surface the
                // cancellation in its own UI.
                throw error;

            }

            logger.error(
                "Failed to send message",
                error
            );

            // The backend message was created before the
            // attachment step; remove the orphan so a failed
            // send never resurfaces as a phantom message
            // (e.g. "[Sent from another device]" on reload).
            if (savedMessage?.id) {

                try {

                    await messageService.deleteForEveryone(
                        savedMessage.id
                    );

                }
                catch (cleanupError) {

                    logger.error(
                        "Failed to remove failed send message:",
                        cleanupError
                    );

                }

            }

            setError(error);

        }

    }

    //--------------------------------------------------
    // Typing
    //--------------------------------------------------

    function typing() {

        websocketService.sendTyping(
            conversation.id
        );

    }

    //--------------------------------------------------
    // Stop Typing
    //--------------------------------------------------

    function stopTyping() {

        websocketService.stopTyping(
            conversation.id
        );

    }
        //--------------------------------------------------
    // Edit Message (end-to-end encrypted)
    //--------------------------------------------------

    async function editMessage(
        messageId,
        newPlaintext,
    ) {

        try {

            let encrypted;

            let recipientKeys = [];

            //--------------------------------------------------
            // Group edit: fresh AES key wrapped to every member
            //--------------------------------------------------

            if (isGroup) {

                if (!groupDetail?.participants?.length) {

                    throw new Error(
                        "Group members are still loading. "
                        + "Try again in a moment."
                    );

                }

                // Re-wrap the key for the CURRENT members; if
                // membership changed since this view was loaded,
                // refresh and re-encrypt once.
                const sendGroupEdit = async (participants) => {

                    const enc =
                        await encryptGroupMessage(
                            newPlaintext,
                            participants,
                            conversation.id,
                        );

                    await messageService.editMessage(
                        messageId,
                        enc,
                    );

                    encrypted = enc;

                    recipientKeys =
                        enc.recipient_keys ?? [];

                };

                try {

                    await sendGroupEdit(
                        groupDetail.participants
                    );

                }
                catch (error) {

                    const detail =
                        error?.response?.data?.detail;

                    if (
                        typeof detail === "string" &&
                        detail.includes(
                            "Group membership changed"
                        )
                    ) {

                        const fresh =
                            await refreshGroupDetail();

                        await sendGroupEdit(
                            fresh?.participants ??
                            groupDetail.participants
                        );

                    }
                    else {

                        throw error;

                    }

                }

            }
            else {

                //--------------------------------------------------
                // Fresh per-device ratchet envelopes (the server
                // never sees the plaintext)
                //--------------------------------------------------

                const [peerBundle, myBundle] = await Promise.all([
                    deviceService.getBundle(
                        conversation.other_user.id
                    ),
                    deviceService.getBundle(
                        user.id
                    ),
                ]);

                encrypted =
                    await encryptForDevices({
                        conversationId: conversation.id,
                        plaintext: newPlaintext,
                        devices: [
                            ...(peerBundle?.devices ?? []),
                            ...(myBundle?.devices ?? []),
                        ],
                    });

                await messageService.editMessage(
                    messageId,
                    encrypted,
                );

            }

            // Optimistic UI update
            setMessages(
                previous => previous.map(
                    message =>

                        message.id === messageId

                            ? {

                                ...message,

                                content: newPlaintext,

                                edited: true,

                                ciphertext:
                                    encrypted.ciphertext,

                                encrypted_key_sender:
                                    encrypted.encrypted_key_sender,

                                encrypted_key_receiver:
                                    encrypted.encrypted_key_receiver,

                                nonce:
                                    encrypted.nonce,

                                recipient_keys:
                                    recipientKeys,

                                envelopes:
                                    encrypted.envelopes ?? [],

                            }

                            : message
                )
            );

            try {

                await signalKeyStore.savePlaintext(
                    conversation.id,
                    messageId,
                    newPlaintext,
                    encrypted.ciphertext,
                );

                // The edited content is fresh plaintext: replace
                // the account-key copy so every browser shows the
                // new text (stale copies are detected via the
                // ciphertext fingerprint).
                void ensureSyncCopy(
                    {
                        id: messageId,
                        ciphertext: encrypted.ciphertext,
                        sync_envelope: null,
                    },
                    newPlaintext,
                    conversation.id,
                );

            }
            catch (error) {

                logger.error(
                    "Failed to cache edited message:",
                    error
                );

            }

            websocketService.sendEdit({
                conversationId: conversation.id,
                messageId,
                encrypted: {
                    ...encrypted,
                    recipient_keys: recipientKeys,
                    envelopes: encrypted.envelopes ?? [],
                },
            });

            return true;

        }

        catch (error) {

            logger.error(
                "Failed to edit message",
                error
            );

            setError(error);

            throw error;

        }

    }

    //--------------------------------------------------
    // Toggle Reaction (optimistic + rollback)
    //--------------------------------------------------

    async function toggleReaction(
        messageId,
        emoji,
    ) {

        const message = messages.find(
            message => message.id === messageId
        );

        const reaction = {
            message_id: messageId,
            user_id: user?.id,
            emoji,
            action:
                message?.reactions?.some(
                    reaction =>
                        reaction.user_id ===
                            String(user?.id) &&
                        reaction.emoji === emoji
                )
                    ? "remove"
                    : "add",
        };

        setMessages(
            previous => previous.map(
                message =>

                    message.id === messageId

                        ? applyReaction(
                            message,
                            reaction
                        )

                        : message
            )
        );

        try {

            await messageService.toggleReaction(
                messageId,
                emoji,
            );

        }
        catch (error) {

            logger.error(
                "Failed to toggle reaction",
                error
            );

            setError(error);

            // Roll back the optimistic update
            setMessages(
                previous => previous.map(
                    message =>

                        message.id === messageId

                            ? applyReaction(
                                message,
                                {
                                    ...reaction,
                                    action:
                                        reaction.action === "add"
                                            ? "remove"
                                            : "add",
                                }
                            )

                            : message
                )
            );

        }

    }

    //--------------------------------------------------
    // Forward Message to multiple users
    //--------------------------------------------------

    async function forwardMessage(
        plaintext,
        targetUsers,
        forwardedCount = 0,
    ) {

        const results = [];

        try {

            for (const targetUser of targetUsers) {

                const targetConversation =
                    await conversationService.createPrivateConversation(
                        targetUser.id
                    );

                const [peerBundle, myBundle] = await Promise.all([
                    deviceService.getBundle(
                        targetUser.id
                    ),
                    deviceService.getBundle(
                        user.id
                    ),
                ]);

                const encrypted =
                    await encryptForDevices({
                        conversationId: targetConversation.id,
                        plaintext,
                        devices: [
                            ...(peerBundle?.devices ?? []),
                            ...(myBundle?.devices ?? []),
                        ],
                    });

                const saved =
                    await messageService.sendMessage(
                        targetConversation.id,
                        encrypted,
                        null,
                        true,
                        forwardedCount,
                    );

                try {

                    await signalKeyStore.savePlaintext(
                        targetConversation.id,
                        saved.id,
                        plaintext,
                        saved.ciphertext,
                    );

                }

                catch (error) {

                    logger.error(
                        "Failed to cache forwarded message:",
                        error
                    );

                }

                // The recipient's socket must see it in real
                // time, exactly like a normal send.
                websocketService.sendMessage({
                    id: saved.id,
                    conversation_id: saved.conversation_id,
                    sender_id: saved.sender_id,
                    ciphertext: saved.ciphertext,
                    encrypted_key_sender: saved.encrypted_key_sender,
                    encrypted_key_receiver: saved.encrypted_key_receiver,
                    nonce: saved.nonce,
                    crypto_version: saved.crypto_version,
                    message_type: saved.message_type,
                    reply_to_id: saved.reply_to_id,
                    is_forwarded: saved.is_forwarded,
                    forwarded_count: saved.forwarded_count,
                    expires_at: saved.expires_at,
                    created_at: saved.created_at,
                    attachments: [],
                    recipient_keys: saved.recipient_keys ?? [],
                    envelopes: saved.envelopes ?? [],
                });

                results.push({
                    conversation:
                        targetConversation,
                    message: saved,
                });

            }

            return results;

        }

        catch (error) {

            logger.error(
                "Failed to forward message",
                error
            );

            setError(error);

            throw error;

        }

    }

    //--------------------------------------------------
    // Delete Message
    //--------------------------------------------------

    async function deleteMessage(
        messageId,
        scope,
    ) {

        try {

            if (scope === "everyone") {

                await messageService.deleteForEveryone(
                    messageId
                );

                //---------
                // Update own UI instantly
                //---------

                setMessages(
                    previous => previous.map(
                        message =>

                            message.id === messageId

                                ? {

                                    ...message,

                                    deleted_for_everyone: true,

                                    content:
                                        "Message deleted",

                                }

                                : message
                    )
                );

                //---------
                // Notify the other participant in real time
                //---------

                websocketService
                    .sendDelete(
                        conversation.id,
                        messageId
                    );

            }
            else {

                await messageService.deleteForMe(
                    messageId
                );

                //---------
                // "Delete for me" removes it from MY history
                //---------

                setMessages(
                    previous => previous.filter(
                        message =>
                            message.id !== messageId
                    )
                );

            }

        }

        catch (error) {

            logger.error(
                "Failed to delete message",
                error
            );

            setError(error);

            throw error;

        }

    }

    //--------------------------------------------------
    // Star / Unstar (per-user, personal)
    //--------------------------------------------------

    async function toggleStarMessage(
        messageId,
        starred,
    ) {

        // Optimistic update
        setMessages(
            previous => previous.map(
                message =>

                    message.id === messageId

                        ? {
                            ...message,
                            is_starred: starred,
                        }

                        : message
            )
        );

        setStarredList(previous =>
            previous.map(
                message =>

                    message.id === messageId

                        ? {
                            ...message,
                            is_starred: starred,
                        }

                        : message
            )
        );

        try {

            await messageService.toggleStar(
                messageId,
                starred,
            );

        }
        catch (error) {

            logger.error(
                "Failed to toggle star",
                error
            );

            setError(error);

            // Roll back the optimistic update
            setMessages(
                previous => previous.map(
                    message =>

                        message.id === messageId

                            ? {
                                ...message,
                                is_starred: !starred,
                            }

                            : message
                )
            );

            throw error;

        }

    }

    //--------------------------------------------------
    // View-once media opened by the recipient
    //--------------------------------------------------

    async function reportViewOnceOpened(messageId) {

        try {

            await messageService.markViewOnceOpened(
                messageId
            );

            // The server broadcasts "view_once_opened" to both
            // sides; this local update keeps the opener's UI
            // instant even if the socket is slow.
            setMessages(
                previous => previous.map(
                    message =>

                        message.id === messageId

                            ? {
                                ...message,
                                view_once_opened: true,
                            }

                            : message
                )
            );

        }
        catch (error) {

            logger.error(
                "Failed to mark view-once media as opened",
                error
            );

            setError(error);

        }

    }

    //--------------------------------------------------
    // Load starred messages of the current conversation
    //--------------------------------------------------

    async function loadStarred() {

        setStarredLoading(true);

        try {

const history =
                await messageService.getMessages(
                    conversation.id,
                    { limit: 0 }
                );

            const decrypted =
                await Promise.all(
                    history.map(
                        async (message) => {

                            try {

                                const plaintext =
                                    await decryptIncoming(message);

                                return {
                                    ...message,
                                    content: plaintext,
                                };

                            }
                            catch {

                                return {
                                    ...message,
                                    content:
                                        "[Unable to decrypt]",
                                };

                            }

                        }
                    )
                );

            setStarredList(decrypted);

        }
        catch (error) {

            logger.error(
                "Failed to load starred messages",
                error
            );

            setStarredList([]);

        }
        finally {

            setStarredLoading(false);

        }

    }

    //--------------------------------------------------
    // Return Hook API
    //--------------------------------------------------

    return {

        messages,

        imageUrls,

        typingUsers,

        loading,

        hasMore,

        loadingOlder,

        loadOlder,

        error,
        sendMessage,

        editMessage,

        toggleReaction,

        toggleStarMessage,

        starredList,

        loadStarred,

        starredLoading,

        reportViewOnceOpened,

        forwardMessage,

        deleteMessage,

        typing,

        stopTyping,

        searchMessages,

        clearSearch,

        searchQuery,

        searchResults,

        searching,

        groupDetail,

        refreshGroupDetail,

    };
}
