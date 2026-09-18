import { useEffect } from "react";
import { useAuth } from "../../context/AuthContext";

import "./Chat.css";

export default function StarredMessagesModal({
    conversationName,
    starredList,
    loading,
    onLoad,
    onUnstar,
    onClose,
}) {

    const { user } = useAuth();

    useEffect(() => {

        onLoad?.();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (

        <div
            className="modal-overlay"
            onClick={onClose}
        >

            <div
                className="forward-modal"
                onClick={(event) =>
                    event.stopPropagation()
                }
            >

                <div className="forward-modal-header">

                    <h3>Starred messages</h3>

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

                <div className="starred-modal-sub">

                    Messages you starred in
                    {" "}
                    {conversationName}

                </div>

                <div className="starred-modal-list">

                    {loading ? (

                        <div className="forward-modal-empty">
                            Loading…
                        </div>

                    ) : starredList.length === 0 ? (

                        <div className="forward-modal-empty">

                            No starred messages. Tap a message
                            and choose Star to keep it here.

                        </div>

                    ) : (

                        starredList.map(message => {

                            const isMine =
                                String(user?.id) ===
                                String(message.sender_id);

                            return (

                                <div
                                    key={message.id}
                                    className="starred-item"
                                >

                                    <div className="starred-item-body">

                                        <div className="starred-item-sender">

                                            {isMine
                                                ? "You"
                                                : "Them"}

                                        </div>

                                        <div className="starred-item-text">

                                            {message.content ||
                                                "Attachment"}

                                        </div>

                                        <div className="starred-item-meta">

                                            {new Date(
                                                message.created_at
                                            ).toLocaleString([], {

                                                month: "short",
                                                day: "numeric",
                                                hour: "2-digit",
                                                minute: "2-digit",

                                            })}

                                            {message.forwarded_count >= 5
                                                ? " · Forwarded many times"
                                                : message.forwarded_count
                                                    ? " · Forwarded"
                                                    : ""}

                                        </div>

                                    </div>

                                    <button
                                        type="button"
                                        className="btn-ghost btn-xs"
                                        title="Remove star"
                                        onClick={() =>
                                            onUnstar?.(message)
                                        }
                                    >

                                        Unstar

                                    </button>

                                </div>

                            );

                        })

                    )}

                </div>

            </div>

        </div>

    );

}