import {
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import MessageBubble from "./MessageBubble";

import { useAuth } from "../../context/AuthContext";

const PIN_THRESHOLD = 80;

// 5 minutes without a message from the same sender ends a group
const GROUP_GAP_MS = 5 * 60 * 1000;

// ==========================================================
// Date divider label: Today / Yesterday / full date
// ==========================================================

function formatDivider(date) {

    const now = new Date();

    const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
    );

    const startOfMessage = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
    );

    const dayDiff = Math.round(
        (startOfToday - startOfMessage) / 86400000
    );

    if (dayDiff === 0) return "Today";

    if (dayDiff === 1) return "Yesterday";

    return date.toLocaleDateString([], {
        day: "numeric",
        month: "short",
        year: date.getFullYear() !== now.getFullYear()
            ? "numeric"
            : undefined,
    });

}

function isSameDay(a, b) {

    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );

}

export default function MessageList({
    messages,
    loading,
    hasMore = false,
    loadingOlder = false,
    onLoadOlder = null,
    onDelete,
    onReply,
    onEdit,
    onForward,
    onInfo,
    onToggleReaction,
    onToggleStar,
    isGroupAdmin = false,
    onViewOnceOpened,
    otherUser,
    conversationId,
    highlightMessageId,
    participantsMap = null,
}) {

    const { user } = useAuth();

    const containerRef = useRef(null);

    const contentRef = useRef(null);

    const pinnedRef = useRef(true);

    const prevConversationRef = useRef(null);

    const highlightRef = useRef(null);

    // Only one message actions menu can be open at a time;
    // owning the state here prevents two dropdowns from
    // overlapping on nearby messages.
    const [openMenuId, setOpenMenuId] =
        useState(null);

    useEffect(() => {

        setOpenMenuId(null);

    }, [conversationId]);

    // ==========================================================
    // Search result jump: scroll the target message into view
    // (centered) without yanking away the bottom pin.
    // ==========================================================

    useEffect(() => {

        if (!highlightMessageId) return;

        pinnedRef.current = false;

        requestAnimationFrame(() => {

            const element = highlightRef.current;

            if (!element) return;

            const container = containerRef.current;

            if (!container) return;

            const top =
                element.offsetTop -
                container.clientHeight / 2;

            container.scrollTo({
                top: Math.max(0, top),
                behavior: "smooth",
            });

        });

    }, [highlightMessageId]);

    // ==========================================================
    // Chronological order: oldest at the top, newest at the
    // bottom (WhatsApp layout). Scrolling up reads history.
    // ==========================================================

    // ==========================================================
    // A new conversation (or the first one) starts pinned to
    // the bottom so the latest message is always visible.
    // ==========================================================

    useEffect(() => {

        if (conversationId !== prevConversationRef.current) {

            prevConversationRef.current = conversationId;

            pinnedRef.current = true;

        }

    }, [conversationId]);

    // ==========================================================
    // Keep track of whether the user is reading at the newest
    // end (bottom). Scrolling up unpins; returning to the
    // bottom re-pins.
    // ==========================================================

    function handleScroll() {

        const container = containerRef.current;

        if (!container) return;

        const distanceFromBottom =
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight;

        pinnedRef.current =
            distanceFromBottom < PIN_THRESHOLD;

        if (
            hasMore &&
            !loadingOlder &&
            !loading &&
            onLoadOlder &&
            container.scrollTop <= 80
        ) {

            onLoadOlder();

        }

    }

    // ==========================================================
    // After the message list changes — or when it finishes
    // loading (the list only appears once `loading` flips to
    // false, and that flip can land in a different render than
    // the messages update) — jump to the newest message if we
    // are pinned there, or if we just sent a message. When the
    // user is reading history, do NOT yank them away.
    // ==========================================================

    useEffect(() => {

        if (loading) return;

        const container = containerRef.current;

        if (!container) return;

        const lastMessage =
            messages[messages.length - 1];

        const isOwn =
            lastMessage &&
            lastMessage.sender_id === user?.id;

        if (pinnedRef.current || isOwn) {

            container.scrollTop =
                container.scrollHeight;

            // A second pass after layout settles (fonts,
            // async content) so the newest message is
            // actually on screen when opening a chat.
            requestAnimationFrame(() => {

                if (
                    container &&
                    pinnedRef.current
                ) {

                    container.scrollTop =
                        container.scrollHeight;

                }

            });

        }

    }, [messages, loading, conversationId, user?.id]);

    // ==========================================================
    // Content size changes (images finishing loading, voice
    // notes, etc.) shift the layout. Stay glued to the newest
    // message as long as the user is pinned at the bottom.
    //
    // Re-attached whenever the list is (re)mounted, because
    // the skeleton replaces the list while loading and the
    // content node is recreated each time.
    // ==========================================================

    useEffect(() => {

        if (loading) return;

        const container = containerRef.current;

        const content = contentRef.current;

        if (!container || !content) return;

        const observer = new ResizeObserver(() => {

            if (pinnedRef.current) {

                container.scrollTop =
                    container.scrollHeight;

            }

        });

        observer.observe(content);

        return () => observer.disconnect();

    }, [loading, conversationId]);

    // ==========================================================
    // Date separators + grouping metadata
    // ==========================================================

    const rows = useMemo(() => {

        const result = [];

        messages.forEach((message, index) => {

            const currentDate =
                new Date(message.created_at);

            const previous =
                messages[index - 1];

            const previousDate =
                previous
                    ? new Date(previous.created_at)
                    : null;

            // Date divider between days
            if (
                !previousDate ||
                !isSameDay(currentDate, previousDate)
            ) {

                result.push({
                    kind: "divider",
                    label: formatDivider(currentDate),
                });

            }

            // Grouping: same sender, close in time, no deletes
            // between them.
            const previousSender =
                previous?.sender_id;

            const gapOk =
                previous &&
                previousDate &&
                currentDate - previousDate <
                    GROUP_GAP_MS;

            const sameSender =
                message.sender_id === previousSender;

            const groupStart =
                !sameSender || !gapOk;

            const next =
                messages[index + 1];

            const nextSender =
                next?.sender_id;

            const nextGap =
                next
                    ? new Date(next.created_at) -
                        currentDate
                    : Number.MAX_SAFE_INTEGER;

            const groupEnd =
                message.sender_id !== nextSender ||
                nextGap >= GROUP_GAP_MS;

            const showName =
                !groupStart &&
                message.sender_id !== user?.id;

            const displayName =
                message.sender_id === user?.id
                    ? user?.display_name ||
                        "You"
                    : (participantsMap?.[
                            message.sender_id
                        ]?.display_name ??
                        otherUser?.display_name) ||
                        "Unknown";

            result.push({
                kind: "message",
                message,
                index,
                groupInfo: {
                    firstInGroup: groupStart,
                    lastInGroup: groupEnd,
                    showName,
                    displayName,
                },
            });

        });

        return result;

    }, [messages, user, otherUser, participantsMap]);

    if (loading) {

        return (

            <div className="chat-loading-list">

                {[0, 1, 2].map((index) => (

                    <div
                        key={index}
                        className={
                            index % 2 === 0
                                ? "chat-loading-bubble alt"
                                : "chat-loading-bubble"
                        }
                    >

                        <div className="skeleton" style={{
                            width: "100%",
                            height: 46,
                            borderRadius: 18,
                        }} />

                    </div>

                ))}

            </div>

        );

    }

    if (messages.length === 0) {

        return (

            <div className="message-list">

                <div className="empty-state">

                    <div className="empty-icon">

                        <svg
                            width="26"
                            height="26"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>

                    </div>

                    <h3>No messages yet</h3>

                    <p>
                        Send the first secure message
                        to start the conversation.
                    </p>

                </div>

            </div>

        );

    }

    return (

        <div
            className="message-list"
            ref={containerRef}
            onScroll={handleScroll}
        >

            <div className="message-list-inner" ref={contentRef}>

                {

                    rows.map(row => {

                        if (row.kind === "divider") {

                            return (

                                <div
                                    key={`divider-${row.label}-${row.message?.id ?? row.index}`}
                                    className="date-divider"
                                >

                                    <span className="date-divider-pill">

                                        {row.label}

                                    </span>

                                </div>

                            );

                        }

                        const { message, groupInfo } = row;

                        // System notices ("X added Y", "X left the
                        // group") render as a centered gray pill,
                        // not a chat bubble (WhatsApp style).
                        if (
                            message.message_type ===
                            "system"
                        ) {

                            return (
                                <div
                                    key={message.id}
                                    className="system-message"
                                >

                                    <span className="system-message-pill">

                                        {message.content ||
                                            message.ciphertext}

                                    </span>

                                </div>

                            );

                        }

                        const repliedMessage =
                            message.reply_to_id
                                ? messages.find(
                                    candidate =>
                                        candidate.id ===
                                        message.reply_to_id
                                )
                                : null;

                        const repliedDisplayName =
                            repliedMessage?.sender_id ===
                            user?.id
                                ? "You"
                                : (participantsMap?.[
                                        repliedMessage?.sender_id
                                    ]?.display_name ??
                                    otherUser?.display_name) ||
                                    "Unknown";

                        const highlight =
                            highlightMessageId ===
                            message.id;

                        return (

                            <div
                                ref={
                                    highlight
                                        ? highlightRef
                                        : null
                                }
                                key={highlight
                                    ? `hl-${message.id}`
                                    : message.id}
                                className={
                                    highlight
                                        ? "message-row-highlight"
                                        : null
                                }
                            >

                            <MessageBubble
                                key={message.id}
                                message={message}
                                onDelete={onDelete}
                                onReply={onReply}
                                onEdit={onEdit}
                                onForward={onForward}
                                onInfo={onInfo}
                                onToggleReaction={
                                    onToggleReaction
                                }
                                onToggleStar={
                                    onToggleStar
                                }
                                isGroupAdmin={
                                    isGroupAdmin
                                }
                                onViewOnceOpened={
                                    onViewOnceOpened
                                }
                                repliedMessage={
                                    repliedMessage
                                }
                                repliedDisplayName={
                                    repliedDisplayName
                                }
                                groupInfo={groupInfo}
                                menuOpen={
                                    openMenuId ===
                                    message.id
                                }
                                onToggleMenu={(open) =>
                                    setOpenMenuId(
                                        open
                                            ? message.id
                                            : null
                                    )
                                }
                            />

                            </div>

                        );

                    })

                }

            </div>

        </div>

    );

}
