import { useState, useRef } from "react";

import { avatarGradient, initials } from "../../utils/avatar";

export default function AddFriendModal({
    onClose,
    searchUsers,
    sendFriendRequest,
    searching = false,
    results = [],
}) {

    const [query, setQuery] = useState("");

    const sentRef = useRef(new Set());

    const handleSearch = (value) => {
        setQuery(value);
        if (typeof searchUsers === "function") {
            searchUsers(value);
        }
    };

    const handleSend = async (userId) => {
        if (sentRef.current.has(userId)) return;
        sentRef.current.add(userId);
        if (typeof sendFriendRequest === "function") {
            await sendFriendRequest(userId);
        }
    };

    return (
        <div
            className="af-modal-backdrop"
            onClick={onClose}
        >
            <div
                className="af-modal"
                onClick={(event) =>
                    event.stopPropagation()
                }
            >
                <div className="af-modal-header">
                    <h3>Add Friend</h3>
                    <button
                        type="button"
                        className="af-close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                <div className="af-search field">
                    <input
                        type="text"
                        placeholder="Search by email..."
                        value={query}
                        onChange={(event) =>
                            handleSearch(event.target.value)
                        }
                        autoFocus
                    />
                </div>

                <div className="af-results">
                    {searching && (
                        <p className="af-hint">
                            <span className="spinner spinner-sm" />
                            {" Searching…"}
                        </p>
                    )}

                    {!searching &&
                        query.length > 0 &&
                        results.length === 0 && (
                            <p className="af-hint">
                                No users found for "
                                <strong>{query}</strong>".
                            </p>
                        )}

                    {results.map((user) => {
                        const sent = sentRef.current.has(
                            user.id
                        );
                        return (
                            <div
                                key={user.id}
                                className="af-result"
                            >
                                <div
                                    className="af-avatar"
                                    style={{
                                        background: avatarGradient(
                                            user.display_name
                                        ),
                                    }}
                                >
                                    {initials(
                                        user.display_name
                                    )}
                                </div>
                                <div className="af-meta">
                                    <strong>
                                        {user.display_name}
                                    </strong>
                                    <small>{user.email}</small>
                                </div>
                                <button
                                    type="button"
                                    className={
                                        sent
                                            ? "btn-primary btn-sm"
                                            : "btn-primary btn-sm"
                                    }
                                    disabled={sent}
                                    onClick={() =>
                                        handleSend(user.id)
                                    }
                                >
                                    {sent
                                        ? "Requested"
                                        : "Add Friend"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
