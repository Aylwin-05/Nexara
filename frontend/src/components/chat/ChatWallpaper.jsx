import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../api/api";
import "./ChatWallpaper.css";

const WALLPAPERS = [
    { id: "none", label: "None", color: null },
    { id: "default", label: "Default", color: "#0b141a" },
    { id: "teal", label: "Teal", color: "#0d3b3b" },
    { id: "blue", label: "Blue", color: "#0d2747" },
    { id: "purple", label: "Purple", color: "#2d1b4e" },
    { id: "warm", label: "Warm", color: "#3d2b1f" },
    { id: "green", label: "Green", color: "#1b3d1f" },
    { id: "pink", label: "Pink", color: "#3d1f2d" },
];

export default function ChatWallpaper({ conversationId, currentWallpaper, onApplied }) {
    const [selected, setSelected] = useState(currentWallpaper || "none");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setSelected(currentWallpaper || "none");
    }, [currentWallpaper]);

    const handleApply = async () => {
        setSaving(true);
        try {
            const wallpaper = selected === "none" ? null : selected;
            await api.patch(`/conversations/${conversationId}/wallpaper`, {
                wallpaper,
            });
            toast.success("Wallpaper updated.");
            onApplied?.(wallpaper);
        } catch {
            toast.error("Failed to update wallpaper.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="chat-wallpaper">
            <h3>Chat Wallpaper</h3>
            <div className="chat-wallpaper__grid">
                {WALLPAPERS.map((wp) => (
                    <button
                        key={wp.id}
                        className={`chat-wallpaper__swatch ${
                            selected === wp.id ? "selected" : ""
                        }`}
                        style={{
                            background: wp.color || "var(--bg-secondary)",
                            border: wp.color
                                ? "2px solid transparent"
                                : "2px dashed var(--border)",
                        }}
                        onClick={() => setSelected(wp.id)}
                        title={wp.label}
                    >
                        {wp.id === "none" && "✕"}
                    </button>
                ))}
            </div>

            <div className="chat-wallpaper__preview">
                <div
                    className="chat-wallpaper__preview-box"
                    style={{
                        background:
                            WALLPAPERS.find((w) => w.id === selected)?.color ||
                            "var(--bg-secondary)",
                    }}
                >
                    <div className="chat-wallpaper__preview-bubble">
                        Sample message
                    </div>
                </div>
            </div>

            <button
                className="chat-wallpaper__apply"
                onClick={handleApply}
                disabled={saving}
            >
                {saving ? "Saving…" : "Apply"}
            </button>
        </div>
    );
}
