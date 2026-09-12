import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { getApiErrorDetail } from "../../utils/errors";
import useMessages from "../../hooks/useMessages";

import ChatInput from "./ChatInput";
import MessageList from "./MessageList";
import ForwardModal from "./ForwardModal";
import MessageInfoPanel from "./MessageInfoPanel";
import DeleteConversationModal from "./DeleteConversationModal";
import GroupInfoModal from "./GroupInfoModal";
import StarredMessagesModal from "./StarredMessagesModal";
import PinnedMessages from "./PinnedMessages";
import MediaGallery from "./MediaGallery";
import ChatWallpaper from "./ChatWallpaper";

import UserAvatar from "../UserAvatar";
import { useAuth } from "../../context/AuthContext";
import { useAndroidBack } from "../../utils/androidBack";
import { useChatSocket } from "../../context/ChatSocketContext";
import { useCall } from "../../context/CallContext";
import blockService from "../../services/blockService";
import api from "../../api/api";

import "./Chat.css";

// ==========================================================
// Disappearing-message durations (seconds), WhatsApp-style
// ==========================================================

const DISAPPEAR_OPTIONS = [
    { label: "Off", seconds: null },
    { label: "24 hours", seconds: 24 * 60 * 60 },
    { label: "7 days", seconds: 7 * 24 * 60 * 60 },
    { label: "90 days", seconds: 90 * 24 * 60 * 60 },
];

function TimerIcon() {
    return (
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
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2.5" />
            <path d="M9 2h6" />
        </svg>
    );
}

function CallIcon({ video }) {
    return video ? (
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
            <path d="m22 8-6 4 6 4V8Z" />
            <rect x="2" y="6" width="14" height="12" rx="2" />
        </svg>
    ) : (
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
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

export default function ChatWindow({
    conversation,
    onLeaveGroup,
}) {

    const { user } = useAuth();

    const {
        presence,
        bumpConversation,
        updateSettings,
        selectConversation,
        refreshStories,
    } = useChatSocket();

    const {
        call: activeCall,
        startCall,
    } = useCall();

    // Always call hooks first
    const {
        messages,
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
    } = useMessages(
        conversation,
        (newMessage) => {

            if (!conversation) return;

            bumpConversation(
                conversation.id,
                newMessage,
            );

        }
    );

    // ==========================================================
    // Bump a conversation to the top with the latest message
    // (delegated to the ChatSocket provider, which owns the
    // sidebar list)
    // ==========================================================

    // ==========================================================
    // Reply / edit / forward / reactions state
    // ==========================================================

    const [replyTo, setReplyTo] =
        useState(null);

    const [editTarget, setEditTarget] =
        useState(null);

    const [forwardTarget, setForwardTarget] =
        useState(null);

    const [infoTarget, setInfoTarget] =
        useState(null);

    const [showTimerMenu, setShowTimerMenu] =
        useState(false);

    const [showSearch, setShowSearch] =
        useState(false);

    const [blocked, setBlocked] =
        useState(false);

    const [blockConfirm, setBlockConfirm] =
        useState(false);

    const [blockBusy, setBlockBusy] =
        useState(false);

    const [deleteOpen, setDeleteOpen] =
        useState(false);

    const [starredOpen, setStarredOpen] =
        useState(false);

    const [groupInfoOpen, setGroupInfoOpen] =
        useState(false);

    const [searchInput, setSearchInput] =
        useState("");

    const [searchIndex, setSearchIndex] =
        useState(0);

    const [highlightMessageId, setHighlightMessageId] =
        useState(null);

    // Mobile ⋮ overflow menu for the chat header actions.
    const [kebabOpen, setKebabOpen] =
        useState(false);

    // Media gallery, chat wallpaper, export, server search
    const [mediaGalleryOpen, setMediaGalleryOpen] = useState(false);
    const [wallpaperOpen, setWallpaperOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [serverSearchOpen, setServerSearchOpen] = useState(false);

    // Android back button: close the topmost overlay first,
    // then leave the conversation itself.
    useAndroidBack(() => {

        if (kebabOpen) {
            setKebabOpen(false);
            return true;
        }

        if (showTimerMenu) {
            setShowTimerMenu(false);
            return true;
        }

        if (blockConfirm) {
            setBlockConfirm(false);
            return true;
        }

        if (deleteOpen) {
            setDeleteOpen(false);
            return true;
        }

        if (starredOpen) {
            setStarredOpen(false);
            return true;
        }

        if (groupInfoOpen) {
            setGroupInfoOpen(false);
            return true;
        }

        if (showSearch) {
            handleCloseSearch();
            return true;
        }

        selectConversation(null);

        return true;

    });

    const searchTimerRef = useRef(null);

    // ==========================================================
    // Search
    // ==========================================================

    function handleSearchChange(value) {

        setSearchInput(value);

        setSearchIndex(0);

        clearTimeout(searchTimerRef.current);

        searchTimerRef.current =
            setTimeout(() => {
                searchMessages(value);
            }, 350);

    }

    function handleCloseSearch() {

        clearTimeout(searchTimerRef.current);

        setShowSearch(false);

        setSearchInput("");

        setSearchIndex(0);

        clearSearch();

    }

    function handleJumpSearch(offset) {

        if (!searchResults.length) return;

        const nextIndex = Math.min(
            searchResults.length - 1,
            Math.max(0, searchIndex + offset),
        );

        setSearchIndex(nextIndex);

        const target = searchResults[nextIndex];

        setHighlightMessageId(null);

        requestAnimationFrame(() => {
            setHighlightMessageId(target.id);
        });

    }

    const currentResult =
        searchResults[searchIndex] ?? null;

    // ==========================================================
    // Disappearing messages
    // ==========================================================

    async function handleSetDisappearing(seconds) {

        try {

            await updateSettings(conversation.id, {
                disappear_after_seconds: seconds,
            });

            toast.success(
                seconds
                    ? "Disappearing messages on. New messages will expire."
                    : "Disappearing messages off.",
            );

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to change disappearing messages."));

        }

    }

    function handleReply(message) {

        setReplyTo({

            ...message,

            sender_display_name:
                senderName(message.sender_id),

        });

    }

    // Close transient panels when switching chats
    useEffect(() => {

        setInfoTarget(null);

        setForwardTarget(null);

        setReplyTo(null);

        setShowTimerMenu(false);

        setDeleteOpen(false);

        setBlockConfirm(false);

        handleCloseSearch();

    }, [conversation?.id]);

    // ==========================================================
    // Block state for the current 1:1 chat
    // ==========================================================

    useEffect(() => {

        let cancelled = false;

        if (
            !conversation ||
            conversation.conversation_type === "group"
        ) {
            return undefined;
        }

        setBlocked(false);

        blockService.getBlockedUsers()
            .then(users => {
                if (!cancelled) {
                    setBlocked(
                        users.some(
                            user =>
                                user.id ===
                                conversation.other_user?.id,
                        )
                    );
                }
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };

    }, [conversation?.id]);

    async function handleToggleBlock() {

        if (
            blockBusy ||
            !conversation?.other_user?.id
        ) {
            return;
        }

        setBlockBusy(true);

        try {

            if (blocked) {

                await blockService.unblockUser(
                    conversation.other_user.id
                );

                setBlocked(false);

                toast.success("User unblocked.");

            }
            else {

                await blockService.blockUser(
                    conversation.other_user.id
                );

                setBlocked(true);

                toast.success(
                    "User blocked. They can no longer " +
                    "message, call or see your presence, " +
                    "status or profile photo."
                );

            }

            refreshStories();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to update block status."));

        }
        finally {

            setBlockBusy(false);

            setBlockConfirm(false);

        }

    }

    function handleEdit(message) {

        setReplyTo(null);

        setEditTarget(message);

    }

    function handleCancelEdit() {

        setEditTarget(null);

    }

    async function handleEditSubmit(messageId, text) {

        await editMessage(messageId, text);

        setEditTarget(null);

    }

    async function handleSend(text, file, options = {}) {

        await sendMessage(
            text,
            file,
            {
                replyToId: replyTo?.id,
                onProgress: options.onProgress,
                signal: options.signal,
                viewOnce: options.viewOnce,
            },
        );

        setReplyTo(null);

    }

    async function handleToggleStar(message) {

        await toggleStarMessage(
            message.id,
            !message.is_starred,
        );

    }

    async function handleForwardSubmit(plaintext, recipients) {

        const results =
            await forwardMessage(
                plaintext,
                recipients,
                forwardTarget?.forwarded_count ?? 0,
            );

        // Surface forwarded copies in the sidebar
        for (const result of results) {

            bumpConversation(
                result.conversation.id,
                {
                    content: plaintext,
                    created_at:
                        result.message.created_at,
                },
                result.conversation,
            );

        }

    }

    // Safe to return AFTER hooks
    if (!conversation) {

        return (

            <div className="chat-empty">

                <div className="chat-empty-logo">

                    <svg
                        width="56"
                        height="56"
                        viewBox="0 0 32 32"
                        fill="none"
                    >
                        <defs>
                            <linearGradient
                                id="emptyGrad"
                                x1="0"
                                y1="0"
                                x2="1"
                                y2="1"
                            >
                                <stop offset="0" stopColor="#7c5cff" />
                                <stop offset="1" stopColor="#22d3ee" />
                            </linearGradient>
                        </defs>
                        <path
                            d="M16 2l12 4v8c0 8-5 14-12 16C9 28 4 22 4 14V6z"
                            fill="url(#emptyGrad)"
                        />
                    </svg>

                </div>

                <h2>Select a conversation</h2>

                <p>
                    Your messages are encrypted end-to-end.
                    Pick a chat to start talking.
                </p>

            </div>

        );

    }

    const otherUser =
        conversation.other_user ?? {
            display_name: "Unknown User",
            online_status: "offline",
        };

    const isGroup =
        conversation.conversation_type === "group";

    const participantsMap = {};

    for (const participant of
        groupDetail?.participants ?? []) {

        participantsMap[participant.user_id] =
            participant.user ??
            participant;

    }

    const groupName =
        groupDetail?.name ?? conversation.name;

    // Private conversations have no name field — show the
    // other user's display name in the header.
    const chatTitle =
        isGroup
            ? groupName
            : otherUser.display_name || "Unknown";

    function senderName(senderId) {

        if (senderId === user?.id) {

            return user?.display_name || "You";

        }

        return (
            participantsMap[senderId]?.display_name ??
            otherUser.display_name
        );

    }

    const countMembers =
        groupDetail?.participants?.length ?? 0;

    const isGroupAdmin =
        Boolean(groupDetail?.is_admin);

    const liveOnline =
        isGroup
            ? false
            : presence[otherUser.id] ??
                otherUser.online_status === "online";

    const typingName =
        typingUsers.length > 0
            ? senderName(typingUsers[0])
            : null;

    // Friendly wording for common errors
    const errorMessage = error
        ? /no (registered )?devic|no-such-device|bundle unavailable/i.test(
            error.message ?? "",
        )
            ? `${senderName(null)} hasn't set up
               end-to-end encryption yet. Ask them to
               log in once so their secure device is ready.`
            : error.message
        : null;

    return (

        <div className="chat-window">

            <div className="chat-header">

                <button
                    type="button"
                    className="chat-back-btn"
                    aria-label="Back to conversations"
                    onClick={() =>
                        selectConversation(null)
                    }
                >
                    <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="m15 18-6-6 6-6" />
                    </svg>
                </button>

                <div className="chat-identity">

                    <UserAvatar
                        user={isGroup
                            ? {
                                id: conversation.id,
                                display_name: groupName,
                                avatar_url:
                                    groupDetail?.avatar_url ??
                                    conversation.avatar_url,
                            }
                            : otherUser}
                        endpoint={
                            isGroup
                                ? `/conversations/${conversation.id}/avatar`
                                : undefined
                        }
                        className="chat-avatar"
                    >

                            {!isGroup && (
                                <span
                                    className={`chat-presence ${
                                        liveOnline ? "online" : ""
                                    }`}
                                />
                            )}

                    </UserAvatar>

                    <div className="chat-heading">

                        <h3 className="chat-name">

                            {chatTitle}

                        </h3>

                        {typingUsers.length > 0 ? (

                            <div className="chat-status typing">

                                <span className="typing-dots">

                                    <span />
                                    <span />
                                    <span />

                                </span>

                                {isGroup
                                    ? `${typingName ?? "Someone"} is typing…`
                                    : "Typing…"}

                            </div>

                        ) : isGroup ? (

                            <div className="chat-status">

                                {countMembers > 0
                                    ? `${countMembers} members`
                                    : "Group"}

                            </div>

                        ) : (

                            <div className="chat-status">

                                {liveOnline
                                    ? "Online"
                                    : "Offline"}

                            </div>

                        )}

                    </div>

                </div>

                <div className="chat-header-actions">

                    <span
                        className="e2e-chip icon-chip header-extra"
                        title="Starred messages"
                    >
                        <button
                            type="button"
                            className="chip-btn"
                            onClick={() =>
                                setStarredOpen(true)
                            }
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                        </button>
                    </span>

                    <span className="e2e-chip icon-chip header-extra" title="Search messages">

                        <button
                            type="button"
                            className="chip-btn"
                            onClick={() => {
                                setShowSearch(v => !v);
                                if (showSearch) {
                                    handleCloseSearch();
                                }
                            }}
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <circle cx="11" cy="11" r="7" />
                                <path d="m21 21-4.35-4.35" />
                            </svg>
                        </button>
                    </span>

                    {showSearch && (

                        <div className="chat-search">

                            <input
                                className="chat-search-input"
                                type="text"
                                placeholder={`Search "${isGroup ? groupName : otherUser.display_name}"`}
                                value={searchInput}
                                autoFocus
                                onChange={(e) =>
                                    handleSearchChange(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        if (e.shiftKey) {
                                            handleJumpSearch(-1);
                                        }
                                        else {
                                            handleJumpSearch(1);
                                        }
                                    }
                                    if (e.key === "Escape") {
                                        handleCloseSearch();
                                    }
                                }}
                            />

                            {searchInput.trim() && (

                                <div className="chat-search-results">

                                    {searching ? (
                                        <div className="chat-search-status">
                                            Searching…
                                        </div>
                                    ) : searchResults.length === 0 ? (
                                        <div className="chat-search-status">
                                            No messages found
                                        </div>
                                    ) : (
                                        <>
                                            <div className="chat-search-meta">
                                                <span className="chat-search-count">
                                                    {searchIndex + 1} of {searchResults.length}
                                                </span>
                                                <div className="chat-search-nav">
                                                    <button
                                                        type="button"
                                                        className="chat-search-nav-btn"
                                                        disabled={searchIndex === 0}
                                                        onClick={() =>
                                                            handleJumpSearch(-1)
                                                        }
                                                    >
                                                        ↑
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="chat-search-nav-btn"
                                                        disabled={
                                                            searchIndex >=
                                                            searchResults.length - 1
                                                        }
                                                        onClick={() =>
                                                            handleJumpSearch(1)
                                                        }
                                                    >
                                                        ↓
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="chat-search-snippet">
                                                <span className="chat-search-sender">
                                                    {currentResult.sender_id === user?.id
                                                        ? "You"
                                                        : otherUser.display_name}
                                                </span>
                                                <span className="chat-search-text">
                                                    {currentResult.content}
                                                </span>
                                            </div>
                                        </>
                                    )}

                                </div>

                            )}

                        </div>

                    )}

                    {!isGroup && otherUser?.id && (

                        <>
                            <span
                                className="e2e-chip icon-chip"
                                title="Voice call (end-to-end encrypted)"
                            >
                                <button
                                    type="button"
                                    className="chip-btn"
                                    disabled={
                                        Boolean(activeCall?.callId)
                                    }
                                    onClick={() =>
                                        startCall(
                                            conversation.id,
                                            "voice",
                                            otherUser.id,
                                            otherUser.display_name,
                                        )
                                    }
                                >
                                    <CallIcon video={false} />
                                </button>
                            </span>

                            <span
                                className="e2e-chip icon-chip"
                                title="Video call (end-to-end encrypted)"
                            >
                                <button
                                    type="button"
                                    className="chip-btn"
                                    disabled={
                                        Boolean(activeCall?.callId)
                                    }
                                    onClick={() =>
                                        startCall(
                                            conversation.id,
                                            "video",
                                            otherUser.id,
                                            otherUser.display_name,
                                        )
                                    }
                                >
                                    <CallIcon video />
                                </button>
                            </span>

                        </>

                    )}

                    {!isGroup && otherUser?.id && (

                        <>
                            <span
                                className={
                                    blocked
                                        ? "e2e-chip icon-chip chip-active header-extra"
                                        : "e2e-chip icon-chip header-extra"
                                }
                                title={
                                    blocked
                                        ? "Unblock this user"
                                        : "Block this user"
                                }
                            >
                                <button
                                    type="button"
                                    className="chip-btn"
                                    disabled={blockBusy}
                                    onClick={() =>
                                        setBlockConfirm(v => !v)
                                    }
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M4.93 4.93l14.14 14.14" />
                                    </svg>
                                </button>
                            </span>

                            {blockConfirm && !blocked && (

                                <div className="block-menu">

                                    <div className="block-menu-head">
                                        Block {otherUser.display_name}?
                                    </div>

                                    <div className="block-menu-note">
                                        They can no longer message
                                        or call you, and can&apos;t
                                        see your presence, status
                                        updates or profile photo.
                                        They&apos;ll be removed from
                                        your friends.
                                    </div>

                                    <div className="block-menu-actions">

                                        <button
                                            type="button"
                                            className="btn-ghost"
                                            onClick={() =>
                                                setBlockConfirm(false)
                                            }
                                        >
                                            Cancel
                                        </button>

                                        <button
                                            type="button"
                                            className="btn-danger"
                                            disabled={blockBusy}
                                            onClick={handleToggleBlock}
                                        >
                                            {blockBusy
                                                ? "Blocking…"
                                                : "Block"}
                                        </button>

                                    </div>

                                </div>

                            )}

                        </>

                    )}

                    <span
                        className={
                            conversation.disappear_after_seconds
                                ? "e2e-chip icon-chip chip-active header-extra"
                                : "e2e-chip icon-chip header-extra"
                        }
                        title={
                            conversation.disappear_after_seconds
                                ? "Disappearing messages on"
                                : "Disappearing messages"
                        }
                    >
                        <button
                            type="button"
                            className="chip-btn"
                            onClick={() =>
                                setShowTimerMenu(v => !v)
                            }
                        >
                            <TimerIcon />
                        </button>
                    </span>

                    {showTimerMenu && (

                        <div className="timer-menu">

                            <div className="timer-menu-head">
                                Disappearing messages
                            </div>

                            {DISAPPEAR_OPTIONS.map(option => {

                                const active =
                                    (conversation.disappear_after_seconds ?? null) ===
                                    option.seconds;

                                return (
                                    <button
                                        key={option.label}
                                        type="button"
                                        className={
                                            active
                                                ? "timer-option active"
                                                : "timer-option"
                                        }
                                        onClick={() => {
                                            handleSetDisappearing(
                                                option.seconds
                                            );
                                            setShowTimerMenu(false);
                                        }}
                                    >
                                        <span>{option.label}</span>
                                        {active && (
                                            <span className="timer-check">✓</span>
                                        )}
                                    </button>
                                );
                            })}

                            <div className="timer-menu-note">
                                New messages in this chat will
                                disappear after this time.
                            </div>

                        </div>

                    )}

                    <span className="e2e-chip" title="Signal protocol, end-to-end encrypted">

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
                            <rect x="3" y="11" width="18" height="11" rx="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>

                        E2E

                    </span>

                    <span
                        className="e2e-chip icon-chip header-extra"
                        title={
                            isGroup
                                ? "Group info"
                                : "Delete chat"
                        }
                    >
                        <button
                            type="button"
                            className="chip-btn"
                            onClick={() =>
                                isGroup
                                    ? setGroupInfoOpen(true)
                                    : setDeleteOpen(true)
                            }
                        >
                            {isGroup ? (
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
                                    <circle cx="18" cy="5" r="3" />
                                    <circle cx="6" cy="12" r="3" />
                                    <circle cx="18" cy="19" r="3" />
                                    <path d="m8.59 13.51 6.83 3.98" />
                                    <path d="m15.41 6.51-6.82 3.98" />
                                </svg>
                            ) : (
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M3 6h18" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                            )}
                        </button>
                    </span>

                    {/* -------- mobile ⋮ overflow menu --------
                        Holds every non-call header action on
                        phones; the chips above keep desktop
                        layout unchanged. */}

                    <button
                        type="button"
                        className={
                            kebabOpen
                                ? "kebab-btn open"
                                : "kebab-btn"
                        }
                        aria-label="More options"
                        aria-expanded={kebabOpen}
                        onClick={() =>
                            setKebabOpen(v => !v)
                        }
                    >
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                        >
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                        </svg>
                    </button>

                    {kebabOpen && (

                        <>

                            <div
                                className="kebab-backdrop"
                                onClick={() =>
                                    setKebabOpen(false)
                                }
                            />

                            <div className="kebab-menu">

                                <button
                                    type="button"
                                    className="kebab-item"
                                    onClick={() => {
                                        setStarredOpen(true);
                                        setKebabOpen(false);
                                    }}
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                    </svg>
                                    Starred messages
                                </button>

                                <button
                                    type="button"
                                    className="kebab-item"
                                    onClick={() => {
                                        setShowSearch(v => !v);
                                        if (showSearch) {
                                            handleCloseSearch();
                                        }
                                        setKebabOpen(false);
                                    }}
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="11" cy="11" r="7" />
                                        <path d="m21 21-4.35-4.35" />
                                    </svg>
                                    Search messages
                                </button>

                                {!isGroup && otherUser?.id && (
                                    <button
                                        type="button"
                                        className="kebab-item"
                                        disabled={blockBusy}
                                        onClick={() => {
                                            setBlockConfirm(v => !v);
                                            setKebabOpen(false);
                                        }}
                                    >
                                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10" />
                                            <path d="M4.93 4.93l14.14 14.14" />
                                        </svg>
                                        {blocked
                                            ? `Unblock ${otherUser.display_name}`
                                            : `Block ${otherUser.display_name}`}
                                    </button>
                                )}

                                <button
                                    type="button"
                                    className={
                                        conversation.disappear_after_seconds
                                            ? "kebab-item kebab-item-on"
                                            : "kebab-item"
                                    }
                                    onClick={() => {
                                        setShowTimerMenu(true);
                                        setKebabOpen(false);
                                    }}
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="9" />
                                        <path d="M12 7v5l3 2" />
                                    </svg>
                                    Disappearing messages
                                    {conversation.disappear_after_seconds
                                        ? " · On"
                                        : ""}
                                </button>

                                <button
                                    type="button"
                                    className="kebab-item"
                                    onClick={() => {
                                        isGroup
                                            ? setGroupInfoOpen(true)
                                            : setDeleteOpen(true);
                                        setKebabOpen(false);
                                    }}
                                >
                                    {isGroup ? (
                                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="3" />
                                            <circle cx="6" cy="6" r="3" />
                                            <circle cx="18" cy="6" r="3" />
                                            <path d="m8.2 8.8 2 2m3.6 0 2-2M8.2 15.2l2-2m3.6 0 2 2" />
                                        </svg>
                                    ) : (
                                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 6h18" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        </svg>
                                    )}
                                    {isGroup ? "Group info" : "Delete chat"}
                                </button>

                                <button
                                    type="button"
                                    className="kebab-item"
                                    onClick={() => {
                                        setMediaGalleryOpen(true);
                                        setKebabOpen(false);
                                    }}
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                        <polyline points="21 15 16 10 5 21" />
                                    </svg>
                                    Media, links &amp; docs
                                </button>

                                <button
                                    type="button"
                                    className="kebab-item"
                                    onClick={() => {
                                        setWallpaperOpen(true);
                                        setKebabOpen(false);
                                    }}
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                        <polyline points="21 15 16 10 5 21" />
                                    </svg>
                                    Chat wallpaper
                                </button>

                                <button
                                    type="button"
                                    className="kebab-item"
                                    disabled={exporting}
                                    onClick={async () => {
                                        setExporting(true);
                                        setKebabOpen(false);
                                        try {
                                            const response = await api.get(
                                                `/conversations/${conversation.id}/export`,
                                                { responseType: "blob" }
                                            );
                                            const url = window.URL.createObjectURL(new Blob([response.data]));
                                            const a = document.createElement("a");
                                            a.href = url;
                                            a.download = `chat_export_${conversation.id}.json`;
                                            document.body.appendChild(a);
                                            a.click();
                                            document.body.removeChild(a);
                                            window.URL.revokeObjectURL(url);
                                            toast.success("Chat exported.");
                                        } catch {
                                            toast.error("Export failed.");
                                        } finally {
                                            setExporting(false);
                                        }
                                    }}
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                    Export chat
                                </button>

                            </div>

                        </>

                    )}

                </div>

            </div>

            {conversation.delete_requested_by === user?.id && (

                <div className="chat-delete-pending-banner">

                    <span>
                        Waiting for {otherUser.display_name}
                        to confirm deleting this chat.
                    </span>

                    <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() =>
                            setDeleteOpen(true)
                        }
                    >
                        View / cancel
                    </button>

                </div>

            )}

            {conversation.disappear_after_seconds ? (

                <div className="disappear-banner">

                    <TimerIcon />

                    {`Messages disappear after ${
                        DISAPPEAR_OPTIONS.find(
                            option =>
                                option.seconds ===
                                conversation.disappear_after_seconds
                        )?.label ??
                        `${conversation.disappear_after_seconds} seconds`
                    }`}

                </div>

            ) : null}

            <PinnedMessages
                conversationId={conversation.id}
                onSelect={(msg) => {
                    setHighlightMessageId(msg.id);
                    setTimeout(() => setHighlightMessageId(null), 3000);
                }}
            />

            <MessageList
                messages={messages}
                loading={loading}
                hasMore={hasMore}
                loadingOlder={loadingOlder}
                onLoadOlder={loadOlder}
                onDelete={deleteMessage}
                onReply={handleReply}
                onEdit={handleEdit}
                onForward={setForwardTarget}
                onInfo={setInfoTarget}
                onToggleReaction={toggleReaction}
                onToggleStar={handleToggleStar}
                isGroupAdmin={isGroupAdmin}
                onViewOnceOpened={reportViewOnceOpened}
                otherUser={otherUser}
                conversationId={conversation.id}
                highlightMessageId={highlightMessageId}
                participantsMap={
                    isGroup ? participantsMap : null
                }
            />

            {errorMessage ? (

                <div className="chat-error-banner">

                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                    >
                        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <path d="M12 9v4M12 17h.01" />
                    </svg>

                    {errorMessage}

                </div>

            ) : null}

            <ChatInput
                onSend={handleSend}
                typing={typing}
                stopTyping={stopTyping}
                replyTo={replyTo}
                onCancelReply={() =>
                    setReplyTo(null)
                }
                editTarget={editTarget}
                onEdit={handleEditSubmit}
                onCancelEdit={handleCancelEdit}
            />

            {forwardTarget && (

                <ForwardModal
                    message={forwardTarget}
                    excludeUserId={
                        isGroup
                            ? user?.id
                            : otherUser.id
                    }
                    onClose={() =>
                        setForwardTarget(null)
                    }
                    onForward={handleForwardSubmit}
                />

            )}

            {infoTarget && (

                <MessageInfoPanel
                    message={infoTarget}
                    otherUser={
                        isGroup
                            ? participantsMap[
                                    infoTarget.sender_id
                                ] ?? otherUser
                            : otherUser
                    }
                    onClose={() =>
                        setInfoTarget(null)
                    }
                />

            )}

            {starredOpen && (

                <StarredMessagesModal
                    conversationName={groupName}
                    starredList={starredList}
                    loading={starredLoading}
                    onLoad={loadStarred}
                    onUnstar={handleToggleStar}
                    onClose={() =>
                        setStarredOpen(false)
                    }
                />

            )}

            {deleteOpen && !isGroup && (

                <DeleteConversationModal
                    conversation={conversation}
                    onClose={() =>
                        setDeleteOpen(false)
                    }
                />

            )}

            {groupInfoOpen && isGroup && (

                <GroupInfoModal
                    conversation={conversation}
                    groupDetail={groupDetail}
                    onClose={() =>
                        setGroupInfoOpen(false)
                    }
                    onUpdated={refreshGroupDetail}
                    onLeave={() => {
                        setGroupInfoOpen(false);
                        onLeaveGroup?.();
                    }}
                />

            )}

            {mediaGalleryOpen && (
                <MediaGallery
                    conversationId={conversation.id}
                    onClose={() => setMediaGalleryOpen(false)}
                />
            )}

            {wallpaperOpen && (
                <ChatWallpaper
                    conversationId={conversation.id}
                    currentWallpaper={conversation.wallpaper}
                    onApplied={(wp) => {
                        setWallpaperOpen(false);
                        conversation.wallpaper = wp;
                    }}
                />
            )}

        </div>

    );

}
