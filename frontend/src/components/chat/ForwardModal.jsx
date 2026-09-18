import { useEffect, useState } from "react";

import friendService from "../../services/friendService";

import { useAuth } from "../../context/AuthContext";

import UserAvatar from "../UserAvatar";

import { useModalAnimation } from "../../hooks/useModalAnimation";

import "./Chat.css";

export default function ForwardModal({
    message,
    onClose,
    onForward,
    excludeUserId = null,
}) {

    const { user } = useAuth();

    const [friends, setFriends] = useState([]);

    const [selected, setSelected] = useState({});

    const [loading, setLoading] = useState(true);

    const [sending, setSending] = useState(false);

    const [error, setError] = useState(null);

    const { contentRef } = useModalAnimation();

    useEffect(() => {

        let cancelled = false;

                async function loadFriends() {

            try {

                const list =
                    await friendService.getFriends();

                if (cancelled) return;

                const available = excludeUserId
                    ? list.filter(
                        friend => {

                            const other =
                                friend.receiver?.id ===
                                user?.id
                                    ? friend.sender
                                    : friend.receiver;

                            return (
                                String(other?.id) !==
                                String(excludeUserId)
                            );

                        }
                    )
                    : list;

                setFriends(available);

            }

            catch (err) {

                if (cancelled) return;

                setError(
                    "Failed to load friends."
                );

            }

            finally {

                if (!cancelled) {

                    setLoading(false);

                }

            }

        }

        loadFriends();

        return () => {

            cancelled = true;

        };

    }, []);

    // ==========================================================
    // Each friendship pairs two users; pick the other one.
    // ==========================================================

    function otherFriend(friend) {

        return friend.receiver?.id === user?.id
            ? friend.sender
            : friend.receiver;

    }

    // ==========================================================
    // Toggle selection
    // ==========================================================

    function handleToggle(friendId) {

        setSelected(previous => {

            const next = {
                ...previous,
            };

            if (next[friendId]) {

                delete next[friendId];

            }
            else {

                next[friendId] = true;

            }

            return next;

        });

    }

    // ==========================================================
    // Forward to all selected recipients
    // ==========================================================

    async function handleSend() {

        const recipients =
            friends
                .filter(friend => selected[friend.id])
                .map(friend => {

                    const other = otherFriend(friend);

                    return {
                        id: other.id,
                        display_name:
                            other.display_name ||
                            other.username ||
                            "Unknown",
                    };

                });

        if (recipients.length === 0) return;

        setSending(true);

        try {

            await onForward?.(
                message.content,
                recipients,
            );

            onClose?.();

        }

        catch (err) {

            setError(
                "Forwarding failed. Try again."
            );

            setSending(false);

        }

    }

    const selectedCount =
        Object.keys(selected).length;

    return (

        <div
            className="modal-overlay"
            onClick={onClose}
        >

            <div
                ref={contentRef}
                className="forward-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Forward message"
                onClick={(event) =>
                    event.stopPropagation()
                }
            >

                <div className="forward-modal-header">

                    <h3>Forward message</h3>

                    <button
                        type="button"
                        className="forward-modal-close"
                        aria-label="Close"
                        onClick={onClose}
                    >

                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>

                    </button>

                </div>

                <div className="forward-modal-preview">

                    <span className="forward-modal-preview-label">

                        Forwarding

                    </span>

                    <span className="forward-modal-preview-text">

                        {message?.content}

                    </span>

                </div>

                <div className="forward-modal-list">

                    {loading ? (

                        <div className="forward-modal-empty">

                            Loading friends...

                        </div>

                    ) : friends.length === 0 ? (

                        <div className="forward-modal-empty">

                            No friends yet. Add friends to
                            forward messages to them.

                        </div>

                    ) : (

                        friends.map(friend => {

                            const other =
                                otherFriend(friend);

                            const isSelected =
                                Boolean(
                                    selected[friend.id]
                                );

                            return (

                                <button
                                    key={friend.id}
                                    type="button"
                                    className={[
                                        "forward-recipient",
                                        isSelected
                                            ? "selected"
                                            : "",
                                    ].join(" ")}
                                    onClick={() =>
                                        handleToggle(friend.id)
                                    }
                                >

                                    <span className="forward-recipient-check">

                                        {isSelected && (

                                            <svg
                                                width="12"
                                                height="12"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="3"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <path d="M20 6 9 17l-5-5" />
                                            </svg>

                                        )}

                                    </span>

                                    <UserAvatar
                                        user={other}
                                        className="forward-recipient-avatar"
                                    />

                                    <span className="forward-recipient-name">

                                        {other.display_name ||
                                            other.username ||
                                            "Unknown"}

                                    </span>

                                </button>

                            );

                        })

                    )}

                </div>

                {error && (

                    <div className="forward-modal-error">

                        {error}

                    </div>

                )}

                <div className="forward-modal-footer">

                    <button
                        type="button"
                        className="forward-modal-cancel"
                        onClick={onClose}
                        disabled={sending}
                    >

                        Cancel

                    </button>

                    <button
                        type="button"
                        className="forward-modal-send"
                        onClick={handleSend}
                        disabled={
                            selectedCount === 0 ||
                            sending
                        }
                    >

                        {sending
                            ? "Forwarding..."
                            : `Forward${selectedCount > 0
                                ? ` (${selectedCount})`
                                : ""}`}

                    </button>

                </div>

            </div>

        </div>

    );

}
