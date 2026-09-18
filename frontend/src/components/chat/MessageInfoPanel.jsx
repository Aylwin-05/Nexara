import { useAuth } from "../../context/AuthContext";

import "./Chat.css";

// ==========================================================
// WhatsApp-style message info: delivery timeline with exact
// sent / delivered / read timestamps plus message metadata.
// ==========================================================

function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString([], {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatTime(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function TimelineRow({ label, detail, ticks, shown, muted }) {
    return (
        <div
            className={
                "msg-info-row" +
                (shown ? "" : " dimmed") +
                (muted ? " muted" : "")
            }
        >
            <span className="msg-info-label">{label}</span>
            <span className="msg-info-time">{detail}</span>
            {ticks && (
                <span className="msg-info-ticks">{ticks}</span>
            )}
        </div>
    );
}

export default function MessageInfoPanel({
    message,
    otherUser,
    onClose,
}) {

    const { user } = useAuth();

    if (!message) return null;

    const isMine = String(message.sender_id) === String(user?.id);

    const senderName = isMine
        ? (user?.display_name ?? "You")
        : (otherUser?.display_name ?? "Unknown");

    const senderAvatar = isMine
        ? user
        : otherUser;

    const deliveredAt = message.delivered_at
        ? formatDate(message.delivered_at)
        : null;

    const readAt = message.read_at
        ? formatDate(message.read_at)
        : null;

    const sentAt = formatDate(message.created_at);

    return (
        <div className="msg-info-overlay" onClick={onClose}>

            <div
                className="msg-info-panel"
                onClick={(event) =>
                    event.stopPropagation()
                }
            >

                <div className="msg-info-head">
                    <h3>Message info</h3>
                    <button
                        type="button"
                        className="msg-info-close"
                        aria-label="Close"
                        onClick={onClose}
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="msg-info-body">

                    {/* Who sent it */}
                    <div className="msg-info-sender">

                        <div className="msg-info-sender-avatar">

                            <img
                                src={
                                    senderAvatar?.avatar_url ??
                                    undefined
                                }
                                alt=""
                                onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                }}
                            />

                            <span className="msg-info-sender-avatar-fallback">
                                {(senderName || "?").slice(0, 1).toUpperCase()}
                            </span>

                        </div>

                        <div className="msg-info-sender-meta">

                            <span className="msg-info-sender-name">
                                {senderName}
                            </span>

                            <span className="msg-info-sender-side">
                                {isMine ? "You" : "Sent by them"}
                            </span>

                        </div>

                    </div>

                    {/* Message content preview */}
                    <div className="msg-info-content">

                        <p className="msg-info-text">
                            {message.content ||
                                "Encrypted message"}
                        </p>

                        {message.message_type !== "text" && (
                            <span className="msg-info-type">
                                {message.message_type}
                            </span>
                        )}

                    </div>

                    {/* Timeline */}
                    <div className="msg-info-timeline">

                        <TimelineRow
                            label="Sent"
                            detail={sentAt}
                            shown={Boolean(sentAt)}
                        />

                        <TimelineRow
                            label="Delivered"
                            detail={deliveredAt ?? "Not yet"}
                            shown={isMine}
                            muted={!deliveredAt}
                        />

                        <TimelineRow
                            label="Read"
                            detail={readAt ?? "Not yet"}
                            shown={isMine}
                            muted={!readAt}
                            ticks={isMine && message.is_read
                                ? "✓✓"
                                : undefined}
                        />

                    </div>

                    {/* Metadata */}
                    <div className="msg-info-meta">

                        {message.edited && (
                            <div className="msg-info-meta-row">
                                <span>Edited</span>
                                <span>{formatTime(message.updated_at)}</span>
                            </div>
                        )}

                        {message.is_forwarded && (
                            <div className="msg-info-meta-row">
                                <span>Forwarded</span>
                                <span>
                                    {message.forwarded_count >= 5
                                        ? "Many times"
                                        : message.forwarded_count || "Yes"}
                                </span>
                            </div>
                        )}

                        {message.expires_at && (
                            <div className="msg-info-meta-row">
                                <span>Disappears</span>
                                <span>{formatDate(message.expires_at)}</span>
                            </div>
                        )}

                        {message.reply_to_id && (
                            <div className="msg-info-meta-row">
                                <span>Reply to</span>
                                <span>#{message.reply_to_id.slice(0, 8)}</span>
                            </div>
                        )}

                    </div>

                </div>

            </div>

        </div>
    );

}