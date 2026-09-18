import { memo } from "react";
import UserAvatar from "../UserAvatar";

import "./ConversationList.css";

function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function PinIcon() {
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
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </svg>
    );
}

function MuteIcon() {
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
            <path d="m19 5-7 7-7 7" />
            <path d="m5 5 7 7 7 7" />
        </svg>
    );
}

function ArchiveIcon() {
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
            <rect x="2" y="3" width="20" height="5" rx="1" />
            <path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
            <path d="M10 12h4" />
        </svg>
    );
}

const ConversationItem = memo(function ConversationItem({
    conversation,
    selected,
    onSelect,
    online,
    onTogglePin,
    onToggleMute,
    onToggleArchive,
}) {

    const isGroup =
        conversation.conversation_type === "group";

    const user = conversation.other_user;

    const groupName =
        conversation.name ||
        conversation.other_user?.display_name ||
        "Group";

    const unread =
        !selected
            ? (conversation.unread_count ?? 0)
            : 0;

    const pinned = Boolean(conversation.is_pinned);

    const muted = Boolean(conversation.muted);

    return (

        <div
            className={
                selected
                    ? "conv-item active"
                    : "conv-item"
            }
            onClick={() => onSelect(conversation)}
        >

            <div className="conv-avatar">

                <UserAvatar
                    user={isGroup
                        ? {
                            id: conversation.id,
                            display_name: groupName,
                            avatar_url: conversation.avatar_url,
                        }
                        : user}
                    endpoint={
                        isGroup
                            ? `/conversations/${conversation.id}/avatar`
                            : undefined
                    }
                    className={
                        isGroup
                            ? "conv-group-avatar"
                            : "conv-avatar-badge"
                    }
                >

                    {!isGroup && (
                        <span
                            className={`presence-dot ${
                                online ? "online" : ""
                            }`}
                        />
                    )}

                </UserAvatar>

            </div>

            <div className="conv-meta">

                <div className="conv-top">

                    <h4 className="conv-name">

                        {pinned && (
                            <span className="conv-pin-icon" title="Pinned">
                                <PinIcon />
                            </span>
                        )}

                        {isGroup
                            ? groupName
                            : user?.display_name || "Unknown"}

                    </h4>

                    <span className="conv-time">

                        {formatTime(
                            conversation.last_message
                                ?.created_at ??
                            conversation.updated_at
                        )}

                    </span>

                </div>

                <div className="conv-bottom">

                    <p className="conv-preview">

                        {muted && (
                            <span className="conv-mute-icon" title="Muted">
                                <MuteIcon />
                            </span>
                        )}

                        {conversation.disappear_after_seconds && (

                            <span
                                className="conv-mute-icon"
                                title="Disappearing messages on"
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
                                    <circle cx="12" cy="13" r="8" />
                                    <path d="M12 9v4l2.5 2.5" />
                                    <path d="M9 2h6" />
                                </svg>
                            </span>

                        )}

                        {isGroup &&
                        !conversation.last_message
                            ? `${
                                conversation.participant_count ??
                                conversation.other_user
                                    ?.participant_count ??
                                ""
                            } members`
                            : conversation.last_message
                                ? conversation.last_message
                                      .message_type === "system"
                                    ? conversation.last_message
                                          .ciphertext
                                    : "Encrypted message"
                                : "No messages yet"}

                    </p>

                    <div className="conv-actions">

                        {unread > 0 ? (

                            <span className="unread-pill">

                                {unread}

                            </span>

                        ) : null}

                        {onTogglePin ? (

                            <button
                                type="button"
                                className="conv-action"
                                title={pinned ? "Unpin" : "Pin"}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTogglePin(conversation);
                                }}
                            >
                                <PinIcon />
                            </button>

                        ) : null}

                        {onToggleMute ? (

                            <button
                                type="button"
                                className="conv-action"
                                title={muted ? "Unmute" : "Mute"}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleMute(conversation);
                                }}
                            >
                                <MuteIcon />
                            </button>

                        ) : null}

                        {onToggleArchive ? (

                            <button
                                type="button"
                                className="conv-action"
                                title={
                                    conversation.is_archived
                                        ? "Unarchive"
                                        : "Archive"
                                }
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleArchive(conversation);
                                }}
                            >
                                <ArchiveIcon />
                            </button>

                        ) : null}

                    </div>

                </div>

            </div>

        </div>

    );

});

export default ConversationItem;