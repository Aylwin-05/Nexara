import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/api";
import { useAuth } from "../../context/AuthContext";
import UserAvatar from "../UserAvatar";
import "./CallLog.css";

function formatDuration(seconds) {
    if (!seconds) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const STATUS_ICONS = {
    missed: { icon: "📞", color: "#ef4444", label: "Missed" },
    answered: { icon: "✅", color: "#22c55e", label: "Answered" },
    declined: { icon: "❌", color: "#f59e0b", label: "Declined" },
};

export default function CallLog({ onBack }) {
    const [calls, setCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const { user } = useAuth();

    useEffect(() => {
        loadCalls();
    }, []);

    async function loadCalls() {
        try {
            const { data } = await api.get("/call/logs", {
                params: { limit: 100 },
            });
            setCalls(data.calls || []);
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="call-log stage-panel">
            <div className="call-log__header">
                <button
                    className="call-log__back"
                    onClick={() =>
                        onBack
                            ? onBack()
                            : navigate(-1)
                    }
                >
                    ←
                </button>
                <h2>Call History</h2>
            </div>

            {loading ? (
                <div className="call-log__loading">Loading…</div>
            ) : calls.length === 0 ? (
                <div className="call-log__empty">
                    <p>No calls yet.</p>
                </div>
            ) : (
                <ul className="call-log__list">
                    {calls.map((call) => {
                        const info = STATUS_ICONS[call.status] || STATUS_ICONS.missed;
                        const isOutgoing = String(call.caller_id) === String(user?.id);

                        return (
                            <li
                                key={call.id}
                                className="call-log__item"
                            >
                                <UserAvatar
                                    user={{
                                        id: call.peer_id,
                                        display_name:
                                            call.peer_display_name ||
                                            "Unknown",
                                        avatar_url:
                                            call.peer_avatar_url || null,
                                    }}
                                />
                                <div className="call-log__info">
                                    <span className="call-log__name">
                                        {isOutgoing
                                            ? `You → ${call.peer_display_name || "Unknown"}`
                                            : call.peer_display_name || "Unknown"}
                                    </span>
                                    <span className="call-log__detail">
                                        {call.call_type === "video" ? "📹 Video" : "📞 Voice"}{" "}
                                        &middot;{" "}
                                        <span style={{ color: info.color }}>
                                            {info.label}
                                        </span>
                                        {call.duration_seconds
                                            ? ` · ${formatDuration(call.duration_seconds)}`
                                            : ""}
                                    </span>
                                </div>
                                <span className="call-log__time">
                                    {call.created_at
                                        ? new Date(call.created_at).toLocaleString()
                                        : ""}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
