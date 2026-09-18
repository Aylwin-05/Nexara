import { useAuth } from "../../context/AuthContext";
import { memo, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import attachmentService, { AttachmentDecryptError } from "../../services/attachmentService";
import ImageLightbox from "./ImageLightbox";
import { animateBubbleIn, animateReactionPop } from "../../utils/animations";
import { messageSnippet } from "../../utils/message";

// ==========================================================
// Quick-reaction emoji row (WhatsApp-style)
// ==========================================================

const REACTION_EMOJIS = [
    "👍",
    "❤️",
    "😂",
    "😮",
    "😢",
    "🙏",
];

// ==========================================================
// WhatsApp-style label for view-once cards.
function viewOnceKind(attachment) {

    if (attachment?.attachment_type === "image") return "Photo";

    if (attachment?.attachment_type === "video") return "Video";

    return "Media";

}

const MessageBubble = memo(function MessageBubble({
    message,
    onDelete,
    onReply,
    onEdit,
    onForward,
    onInfo,
    onToggleReaction,
    onToggleStar,
    repliedMessage,
    repliedDisplayName = "",
groupInfo = {},
    isGroupAdmin = false,
    onViewOnceOpened,
    menuOpen = false,
    onToggleMenu,
}) {

    const { user } = useAuth();

const [attachmentUrls, setAttachmentUrls] = useState({});

    const [failedAttachments, setFailedAttachments] = useState(
        () => new Set()
    );

    const [lightbox, setLightbox] = useState(null);

    const [confirming, setConfirming] = useState(null);

    const [menuUp, setMenuUp] = useState(false);

    const [copied, setCopied] = useState(false);

    const menuRef = useRef(null);

    const viewOnceUrlRef = useRef(null);

    // Keep the latest onToggleMenu without re-registering
    // the outside-click listener on every render.
    const onToggleMenuRef = useRef(onToggleMenu);

    onToggleMenuRef.current = onToggleMenu;

    // ---- WhatsApp-style touch gestures --------------------
    // • Long-press (~480 ms) opens this message's actions
    //   menu (reactions / reply / …).
    // • A horizontal drag swipes the bubble and replies on
    //   release past 56 px.
    // • Vertical movement always yields to native scrolling,
    //   and desktop mouse input never touches any of this.

    const pressTimerRef = useRef(null);

    const longPressAtRef = useRef(0);

    const touchRef = useRef({
        active: false,
        startX: 0,
        startY: 0,
        lastX: 0,
        swiping: false,
        longPressed: false,
    });

    const [swipeDx, setSwipeDx] = useState(0);

    const bubbleRef = useRef(null);
    const reactionsRef = useRef(null);

    const reactionGroups =
        Object.values(
            (message.reactions || []).reduce(
                (groups, reaction) => {

                    if (!groups[reaction.emoji]) {

                        groups[reaction.emoji] = {
                            emoji: reaction.emoji,
                            count: 0,
                            mine: false,
                        };

                    }

                    groups[reaction.emoji].count += 1;

                    if (
                        reaction.user_id ===
                        String(user?.id)
                    ) {

                        groups[reaction.emoji].mine = true;

                    }

                    return groups;

                },
                {},
            )
        );

    const prevReactionCount = useRef(reactionGroups.length);

    useEffect(() => {
        animateBubbleIn(bubbleRef.current);
    }, []);

    useEffect(() => {
        if (reactionGroups.length > prevReactionCount.current) {
            const chips = reactionsRef.current?.querySelectorAll(".reaction-chip");
            if (chips?.length) {
                animateReactionPop(chips[chips.length - 1]);
            }
        }
        prevReactionCount.current = reactionGroups.length;
    }, [reactionGroups.length]);

    useEffect(() => () => {
        clearTimeout(pressTimerRef.current);
    }, []);

    function handleBubbleTouchStart(event) {

        if (deleted) return;

        const touch = event.touches[0];

        touchRef.current = {
            active: true,
            startX: touch.clientX,
            startY: touch.clientY,
            lastX: touch.clientX,
            swiping: false,
            longPressed: false,
        };

        clearTimeout(pressTimerRef.current);

        pressTimerRef.current = setTimeout(() => {

            const state = touchRef.current;

            if (!state.active || state.swiping) return;

            state.longPressed = true;

            longPressAtRef.current = Date.now();

            navigator.vibrate?.(35);

            setConfirming(null);

            onToggleMenuRef.current?.(true);

        }, 480);

    }

    function handleBubbleTouchMove(event) {

        const state = touchRef.current;

        if (!state.active) return;

        const touch = event.touches[0];

        const dx = touch.clientX - state.startX;
        const dy = touch.clientY - state.startY;

        if (!state.swiping && !state.longPressed) {

            if (
                Math.abs(dy) > 10 &&
                Math.abs(dy) >= Math.abs(dx)
            ) {
                // Vertical intent → let scrolling win.
                clearTimeout(pressTimerRef.current);
                state.active = false;
                return;
            }

            if (Math.abs(dx) > 12) {
                clearTimeout(pressTimerRef.current);
                state.swiping = true;
            }

        }

        if (!state.swiping) return;

        // Rubber-band resistance past 72 px.
        const capped =
            Math.abs(dx) <= 72
                ? dx
                : Math.sign(dx) *
                  (72 + (Math.abs(dx) - 72) * 0.25);

        state.lastX = touch.clientX;

        setSwipeDx(capped);

    }

    function handleBubbleTouchEnd(event) {

        clearTimeout(pressTimerRef.current);

        const state = touchRef.current;

        state.active = false;

        if (state.swiping) {

            event.preventDefault();

            state.swiping = false;

            setSwipeDx(0);

            const dx = state.lastX - state.startX;

            if (Math.abs(dx) >= 56 && !deleted) {
                onToggleMenuRef.current?.(false);
                onReply?.(message);
            }

            return;

        }

        if (state.longPressed) {
            // Swallow the synthetic click that follows a
            // long-press — otherwise the document click
            // handler would instantly re-close the menu we
            // just opened.
            event.preventDefault();
        }

    }

    // Close the actions menu when clicking elsewhere.
    // NOTE: deliberately NOT closed on scroll — the menu is
    // positioned inside its message row, so it scrolls along
    // with the row and never detaches from it.
    useEffect(() => {

        if (!menuOpen) return;

        function closeMenu(event) {

            // Ignore the synthetic click fired right after a
            // long-press opened this menu.
            if (
                event &&
                Date.now() - longPressAtRef.current < 500
            ) {
                return;
            }

            onToggleMenuRef.current?.(false);

            setConfirming(null);

        }

        document.addEventListener(
            "click",
            closeMenu,
        );

        return () => {

            document.removeEventListener(
                "click",
                closeMenu,
            );

        };

    }, [menuOpen]);

    // Flip the dropdown upward when it would run past the
    // bottom edge of the window (e.g. the latest message).
    // Re-measures while open — even during a scroll — but
    // only flips; it never closes the menu.
    useEffect(() => {

        if (!menuOpen) return;

        let frame = null;

        const measure = () => {

            const menu = menuRef.current;

            if (!menu) return;

            const rect = menu.getBoundingClientRect();

            const overflowsBottom =
                rect.bottom > window.innerHeight - 8;

            setMenuUp(previous =>
                previous === overflowsBottom
                    ? previous
                    : overflowsBottom
            );

        };

        const measureScheduled = () => {

            cancelAnimationFrame(frame);

            frame = requestAnimationFrame(measure);

        };

        measure();

        window.addEventListener(
            "resize",
            measureScheduled,
        );

        window.addEventListener(
            "scroll",
            measureScheduled,
            true,
        );

        return () => {

            cancelAnimationFrame(frame);

            window.removeEventListener(
                "resize",
                measureScheduled,
            );

            window.removeEventListener(
                "scroll",
                measureScheduled,
                true,
            );

        };

    }, [menuOpen, confirming]);

    // ==========================================================
    // Delete actions
    // ==========================================================

    async function handleAction(scope) {

        // "Delete for everyone" needs a second tap to confirm
        if (
            scope === "everyone" &&
            confirming !== "everyone"
        ) {

            setConfirming("everyone");

            return;

        }

        onToggleMenuRef.current?.(false);

        setConfirming(null);

        await onDelete?.(
            message.id,
            scope,
        );

    }

    // ==========================================================
    // Load attachment blobs (authenticated + decrypted)
    //
    // Reload only when the actual attachment set changes, NOT
    // when unrelated updates (read receipts, typing) remap the
    // message objects — otherwise old blob URLs get replaced
    // (and revoked) while the lightbox is still showing one.
    // ==========================================================

    const attachmentKey =
        `${message.id}:${(message.attachments || [])
            .map(attachment => attachment.id)
            .join(",")}`;

    const urlsRef = useRef({});

    useEffect(() => {

        let cancelled = false;

        async function loadAttachments() {

            const urls = {};

for (const attachment of message.attachments || []) {

                // View-once media is NEVER fetched automatically —
                // not even by the sender (WhatsApp-style: nobody
                // gets a preview). The recipient fetches exactly
                // once, on tap, and reporting it closed deletes
                // the file server-side.
                if (attachment.view_once) {

                    continue;

                }

                try {

                    const blob =
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

                                syncBlob:
                                    attachment.sync_blob,
                            }
                        );

                    urls[attachment.id] = URL.createObjectURL(blob);

                }

catch (err) {

                    if (err instanceof AttachmentDecryptError) {

                        // Keys for this attachment no longer
                        // exist on this device (stale session /
                        // re-registration): show a placeholder
                        // instead of a broken blob and don't
                        // retry on every mount.
                        setFailedAttachments(previous => {

                            if (previous.has(attachment.id)) {

                                return previous;

                            }

                            const next = new Set(previous);

                            next.add(attachment.id);

                            return next;

                        });

                        continue;

                    }

                    console.error(
                        "Attachment load failed:",
                        err
                    );

                }

            }

            if (cancelled) {

                Object.values(urls).forEach(url =>
                    URL.revokeObjectURL(url)
                );

                return;

            }

            setAttachmentUrls(urls);

        }

        loadAttachments();

        return () => {

            cancelled = true;

        };

    }, [attachmentKey, user?.id]);

    // ==========================================================
    // Cleanup blob URLs — only on unmount (switching messages
    // or leaving the chat), so live lightbox URLs stay valid.
    // ==========================================================

    useEffect(() => {

        urlsRef.current = attachmentUrls;

    }, [attachmentUrls]);

    useEffect(() => {

        return () => {

            Object.values(urlsRef.current).forEach(url => {

                URL.revokeObjectURL(url);

            });

        };

    }, []);

    if (!message) return null;

const isMine =
        String(user?.id) ===
        String(message.sender_id);

    // ----------------------------------------------------------
    // View-once media: fetch + decrypt on demand (recipient only)
    // ----------------------------------------------------------

    async function openViewOnce(attachment) {

        try {

            const blob =
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

                        syncBlob:
                            attachment.sync_blob,
                    }
                );

            viewOnceUrlRef.current =
                URL.createObjectURL(blob);

            setLightbox({
                attachment,
                url: viewOnceUrlRef.current,
                viewOnce: true,
            });

        }
        catch (err) {

            console.error(
                "View-once media load failed:",
                err
            );

            toast.error(
                "Could not open this media. It may have "
                + "already been viewed or deleted."
            );

        }

    }

    const deleted =
        message.deleted_for_everyone;

    const content = deleted
        ? "Message deleted"
        : message.content;

    // --------------------------------------------------------
    // What can this message do?
    // --------------------------------------------------------

    const isText =
        Boolean(content) &&
        content !== "[Unable to decrypt]" &&
        content !== "[Sent from another device]" &&
        content !== "[Encrypted for another device]" &&
        !deleted;

    const canEdit =
        isMine && isText;

const canForward =
        isText;

    // WhatsApp-style: the sender, or any group admin, can
    // delete a message for everyone.
    const canDeleteEveryone =
        isMine || isGroupAdmin;

    // --------------------------------------------------------
    // Reactions: grouped chips with counts
    // --------------------------------------------------------

    const myReaction =
        (message.reactions || []).find(
            reaction =>
                reaction.user_id ===
                String(user?.id)
        );

    const repliedSenderName =
        repliedDisplayName ||
        (repliedMessage?.sender_id === user?.id
            ? "You"
            : "Unknown");

    const messageRowClass = [
        "message-row",
        isMine ? "mine" : "other",
        groupInfo.firstInGroup
            ? "first-in-group"
            : "",
        groupInfo.lastInGroup
            ? "last-in-group"
            : "",
    ].join(" ");

    return (

        <div
            className={messageRowClass}
            style={menuOpen ? { zIndex: 60 } : undefined}
        >

            <div
                ref={bubbleRef}
                className={[
                    "message-bubble",
                    isMine ? "mine" : "other",
                    deleted ? "deleted" : "",
                    groupInfo.lastInGroup
                        ? "tail"
                        : "",
                ].join(" ")}
                style={{
                    transform: swipeDx
                        ? `translateX(${swipeDx}px)`
                        : undefined,
                    transition: swipeDx
                        ? "none"
                        : "transform 0.18s ease-out",
                }}
                onTouchStart={handleBubbleTouchStart}
                onTouchMove={handleBubbleTouchMove}
                onTouchEnd={handleBubbleTouchEnd}
                onContextMenu={(event) => {
                    // Phones: long-press is ours — keep the
                    // native text-selection popup out of the
                    // way. Desktop right-click stays native.
                    if (window.matchMedia("(hover: none)").matches) {
                        event.preventDefault();
                    }
                }}
            >

                {/* SENDER NAME (grouped other chats) */}

                {!isMine &&
                    groupInfo.showName &&
                    !deleted && (

                        <span className="message-sender-name">

                            {groupInfo.displayName ||
                                "Unknown"}

                        </span>

                    )}

                {/* FORWARDED LABEL */}

{message.is_forwarded && !deleted && (

                    <span className="message-forwarded">

                        {message.forwarded_count >= 5
                            ? "Forwarded many times"
                            : "Forwarded"}

                    </span>

                )}

                {/* ACTIONS MENU */}

                {!deleted && (

                    <div
                        className={`bubble-actions ${
                            menuOpen ? "open" : ""
                        }`}
                    >

                        <button
                            type="button"
                            className="bubble-actions-btn"
                            aria-label="Message actions"
                            aria-expanded={menuOpen}
                            aria-haspopup="menu"
                            onMouseDown={(event) =>
                                event.preventDefault()
                            }
                            onClick={(event) => {

                                event.stopPropagation();

                                onToggleMenuRef.current?.(
                                    !menuOpen
                                );

                                setConfirming(null);

                            }}
                        >

                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <circle cx="5" cy="12" r="1.7" />
                                <circle cx="12" cy="12" r="1.7" />
                                <circle cx="19" cy="12" r="1.7" />
                            </svg>

                        </button>

                        {menuOpen && (

                            <div
                                ref={menuRef}
                                className={`bubble-menu ${
                                    menuUp ? "up" : ""
                                }`}
                                onClick={(event) =>
                                    event.stopPropagation()
                                }
                            >

                                {/* QUICK REACTIONS */}

                                <div className="bubble-reactions-row">

                                    {REACTION_EMOJIS.map(emoji => {

                                        const active =
                                            myReaction?.emoji ===
                                            emoji;

                                        return (

                                            <button
                                                key={emoji}
                                                type="button"
                                                className={[
                                                    "bubble-reaction-btn",
                                                    active
                                                        ? "active"
                                                        : "",
                                                ].join(" ")}
                                                aria-label={`React ${emoji}`}
                                                onClick={() => {

                                                    onToggleMenuRef.current?.(false);

                                                    onToggleReaction?.(
                                                        message.id,
                                                        emoji,
                                                    );

                                                }}
                                            >

                                                {emoji}

                                            </button>

                                        );

                                    })}

                                </div>

                                <button
                                    type="button"
                                    className="bubble-menu-item"
                                    onClick={() => {

                                        onToggleMenuRef.current?.(false);

                                        onInfo?.(message);

                                    }}
                                >

                                    Info

                                </button>

                                <button
                                    type="button"
                                    className="bubble-menu-item"
                                    onClick={() => {

                                        onToggleMenuRef.current?.(false);

                                        onReply?.(message);

                                    }}
                                >

Reply

                                </button>

                                {isText && (

                                    <button
                                        type="button"
                                        className="bubble-menu-item"
                                        onClick={() => {

                                            onToggleMenuRef.current?.(false);

                                            navigator.clipboard
                                                .writeText(content)
                                                .then(() => {

                                                    setCopied(true);

                                                    setTimeout(
                                                        () =>
                                                            setCopied(false),
                                                        1500,
                                                    );

                                                })
                                                .catch(() => {
                                                    // clipboard blocked
                                                });

                                        }}
                                    >

                                        {copied
                                            ? "Copied"
                                            : "Copy"}

                                    </button>

                                )}

                                {canEdit && (

                                    <button
                                        type="button"
                                        className="bubble-menu-item"
                                        onClick={() => {

                                            onToggleMenuRef.current?.(false);

                                            onEdit?.(message);

                                        }}
                                    >

                                        Edit

                                    </button>

                                )}

{canForward && (

                                    <button
                                        type="button"
                                        className="bubble-menu-item"
                                        onClick={() => {

                                            onToggleMenuRef.current?.(false);

                                            onForward?.(message);

                                        }}
                                    >

                                        Forward

                                    </button>

                                )}

                                {!deleted && (

                                    <button
                                        type="button"
                                        className="bubble-menu-item"
                                        onClick={() => {

                                            onToggleMenuRef.current?.(false);

                                            onToggleStar?.(message);

                                        }}
                                    >

                                        {message.is_starred
                                            ? "Unstar"
                                            : "Star"}

                                    </button>

                                )}

                                <button
                                    type="button"
                                    className="bubble-menu-item"
                                    onClick={() =>
                                        handleAction("me")
                                    }
                                >

                                    Delete for me

                                </button>

{canDeleteEveryone && (

                                    <button
                                        type="button"
                                        className={[
                                            "bubble-menu-item",
                                            "danger",
                                            confirming === "everyone"
                                                ? "confirm"
                                                : "",
                                        ].join(" ")}
                                        onClick={() =>
                                            handleAction("everyone")
                                        }
                                    >

                                        {confirming === "everyone"
                                            ? "Tap again to confirm"
                                            : "Delete for everyone"}

                                    </button>

                                )}

                            </div>

                        )}

                    </div>

                )}

                {/* REPLY PREVIEW */}

                {message.reply_to_id &&
                    repliedMessage &&
                    !deleted && (

                        <div className="message-reply-preview">

                            <div className="message-reply-accent" />

                            <div className="message-reply-body">

                                <span className="message-reply-name">

                                    {repliedSenderName}

                                </span>

                                <span className="message-reply-text">

                                    {messageSnippet(
                                        repliedMessage
                                    )}

                                </span>

                            </div>

                        </div>

                    )}

                {/* TEXT */}

                {content && !deleted && (

                    <div className="message-content">

                        {content}

                    </div>

                )}

                {content && deleted && (

                    <div className="message-content deleted-content">

                        {content}

                    </div>

                )}

                {/* ATTACHMENTS */}

{message.attachments?.map((attachment) => {

                    const url =
                        attachmentUrls[attachment.id];

                    // --------------------------------------------------
                    // View-once media states (WhatsApp-style: a card
                    // for everyone — never an inline preview)
                    // --------------------------------------------------

                    if (attachment.view_once) {

                        // Opened: the server has already deleted
                        // the file — both sides see the same card.
                        if (message.view_once_opened) {

                            return (

                                <div
                                    key={attachment.id}
                                    className="view-once-card opened"
                                >

                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                                        <line x1="1" y1="1" x2="23" y2="23" />
                                    </svg>

                                    <span>
                                        {viewOnceKind(attachment)}
                                        {" · Opened"}
                                    </span>

                                </div>

                            );

                        }

                        // Recipient, not yet opened: tap to view.
                        if (!isMine) {

                            return (

                                <button
                                    key={attachment.id}
                                    type="button"
                                    className="view-once-card"
                                    onClick={() =>
                                        openViewOnce(attachment)
                                    }
                                >

                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                        <circle cx="12" cy="12" r="3" />
                                    </svg>

                                    <span>
                                        View once · Tap to open
                                    </span>

                                </button>

                            );

                        }

                        // Sender, not yet opened: static card —
                        // no preview, nothing to tap.
                        return (

                            <div
                                key={attachment.id}
                                className="view-once-card mine"
                            >

                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                                    <line x1="1" y1="1" x2="23" y2="23" />
                                </svg>

                                <span>
                                    View once · {viewOnceKind(attachment)}
                                </span>

                            </div>

                        );

                    }

                    if (!url) {

                        if (failedAttachments.has(attachment.id)) {

                            return (

                                <div
                                    key={attachment.id}
                                    className="attachment-undecryptable"
                                    title="The key to decrypt this attachment is no longer available on this device"
                                >

                                    <svg
                                        width="15"
                                        height="15"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >

                                        <rect
                                            x="3"
                                            y="11"
                                            width="18"
                                            height="11"
                                            rx="2"
                                            ry="2"
                                        />

                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />

                                    </svg>

                                    <span>
                                        Attachment can't be
                                        decrypted on this device
                                    </span>

                                </div>

                            );

                        }

                        return null;

                    }

                    switch (attachment.attachment_type) {

case "image":

                            return (

                                <div
                                    key={attachment.id}
                                >

                                    <img
                                        src={url}
                                        alt={attachment.original_name}
                                        className="chat-image"
                                        onClick={() => setLightbox({
                                            attachment,
                                            url,
                                        })}
                                    />

                                </div>

                            );

                        case "voice":

                        case "audio":

                            return (

                                <audio
                                    key={attachment.id}
                                    controls
                                    src={url}
                                    className="chat-audio"
                                />

                            );

case "video":

                            return (

                                <div
                                    key={attachment.id}
                                >

                                    <video
                                        controls
                                        src={url}
                                        className="chat-video"
                                    />

                                </div>

                            );

                        default:

                            return (

                                <a
                                    key={attachment.id}
                                    href={url}
                                    download={attachment.original_name}
                                    className="message-attachment"
                                >

                                    <svg
                                        width="15"
                                        height="15"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                    </svg>

                                    {attachment.original_name}

                                </a>

                            );

                    }

                })}

                {/* REACTION CHIPS */}

                {reactionGroups.length > 0 && !deleted && (

                    <div className="message-reactions" ref={reactionsRef}>

                        {reactionGroups.map(group => (

                            <button
                                key={group.emoji}
                                type="button"
                                className={[
                                    "reaction-chip",
                                    group.mine ? "mine" : "",
                                ].join(" ")}
                                title={
                                    group.mine
                                        ? "Tap to remove"
                                        : ""
                                }
                                onClick={() => {

                                    if (group.mine) {

                                        onToggleReaction?.(
                                            message.id,
                                            group.emoji,
                                        );

                                    }

                                }}
                            >

                                <span className="reaction-chip-emoji">

                                    {group.emoji}

                                </span>

                                {group.count > 1 && (

                                    <span className="reaction-chip-count">

                                        {group.count}

                                    </span>

                                )}

                            </button>

                        ))}

                    </div>

                )}

                {/* FOOTER */}

                <div className="message-footer">

                    <span className="message-time">

                        {new Date(
                            message.created_at
                        ).toLocaleTimeString([], {

                            hour: "2-digit",

                            minute: "2-digit",

                        })}

                    </span>

                    {message.expires_at && !deleted && (

                        <span
                            className="message-timer"
                            title="Disappearing message"
                        >
                            <svg
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <circle cx="12" cy="13" r="8" />
                                <path d="M12 9v4l2.5 2.5" />
                                <path d="M9 2h6" />
                            </svg>
                        </span>

                    )}

                    {message.edited && (

                        <span className="message-edited">

                            Edited

                        </span>

                    )}

                    {isMine && !deleted && (

                        <span
                            className={
                                message.is_read
                                    ? "message-status read"
                                    : "message-status"
                            }
                        >

                            {message.is_read
                                ? "✓✓"
                                : message.delivered_at
                                    ? "✓✓"
                                    : "✓"}

                        </span>

                    )}

                </div>

            </div>

<ImageLightbox
                attachment={lightbox?.attachment}
                url={lightbox?.url}
                viewOnce={lightbox?.viewOnce}
                onClose={() => {

                    const wasViewOnce =
                        Boolean(lightbox?.viewOnce);

                    setLightbox(null);

                    if (wasViewOnce) {

                        // The recipient has now seen the media:
                        // destroy it server-side and tell the
                        // sender in real time.
                        if (viewOnceUrlRef.current) {

                            URL.revokeObjectURL(
                                viewOnceUrlRef.current
                            );

                            viewOnceUrlRef.current = null;

                        }

                        onViewOnceOpened?.(message.id);

                    }

                }}
            />

        </div>

    );

});

export default MessageBubble;

