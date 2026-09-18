import { useEffect, useState } from "react";
import api from "../../api/api";
import "./PinnedMessages.css";

export default function PinnedMessages({ conversationId, onSelect }) {
    const [pinned, setPinned] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadPinned();
    }, [conversationId]);

    async function loadPinned() {
        try {
            const { data } = await api.get(
                `/messages/pinned/${conversationId}`
            );
            setPinned(data.messages || []);
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="pinned-messages__loading">Loading…</div>;
    }

    if (pinned.length === 0) {
        return null;
    }

    return (
        <div className="pinned-messages">
            <div className="pinned-messages__header">
                <span className="pinned-messages__icon">📌</span>
                <span className="pinned-messages__count">
                    {pinned.length} pinned message{pinned.length !== 1 ? "s" : ""}
                </span>
            </div>
            <div className="pinned-messages__list">
                {pinned.slice(0, 3).map((msg) => (
                    <div
                        key={msg.id}
                        className="pinned-messages__item"
                        onClick={() => onSelect?.(msg)}
                    >
                        <span className="pinned-messages__snippet">
                            {msg.ciphertext?.slice(0, 80) || "…"}
                        </span>
                        <span className="pinned-messages__time">
                            {msg.created_at
                                ? new Date(msg.created_at).toLocaleDateString()
                                : ""}
                        </span>
                    </div>
                ))}
                {pinned.length > 3 && (
                    <div className="pinned-messages__more">
                        +{pinned.length - 3} more
                    </div>
                )}
            </div>
        </div>
    );
}
