import { useEffect, useState } from "react";
import api from "../../api/api";
import "./MediaGallery.css";

export default function MediaGallery({ conversationId, onClose }) {
    const [media, setMedia] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadMedia();
    }, [conversationId]);

    async function loadMedia() {
        try {
            const { data } = await api.get(
                `/conversations/${conversationId}/media`
            );
            setMedia(data.media || []);
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }

    const grouped = media.reduce((acc, item) => {
        const type = item.mime_type?.split("/")[0] || "other";
        if (!acc[type]) acc[type] = [];
        acc[type].push(item);
        return acc;
    }, {});

    return (
        <div className="media-gallery">
            <div className="media-gallery__header">
                <h3>Media Gallery</h3>
                <button className="media-gallery__close" onClick={onClose}>
                    ✕
                </button>
            </div>

            {loading ? (
                <div className="media-gallery__loading">Loading…</div>
            ) : media.length === 0 ? (
                <div className="media-gallery__empty">
                    No media shared yet.
                </div>
            ) : (
                <>
                    <p className="media-gallery__count">
                        {media.length} item{media.length !== 1 ? "s" : ""}
                    </p>
                    {Object.entries(grouped).map(([type, items]) => (
                        <div key={type} className="media-gallery__section">
                            <h4 className="media-gallery__section-title">
                                {type.charAt(0).toUpperCase() + type.slice(1)}
                                <span className="media-gallery__section-count">
                                    ({items.length})
                                </span>
                            </h4>
                            <div className="media-gallery__grid">
                                {items.map((item) => (
                                    <div
                                        key={item.id}
                                        className="media-gallery__thumb"
                                        title={item.filename || "Attachment"}
                                    >
                                        {type === "image" ? (
                                            <div className="media-gallery__img-placeholder">
                                                🖼
                                            </div>
                                        ) : type === "video" ? (
                                            <div className="media-gallery__img-placeholder">
                                                🎬
                                            </div>
                                        ) : type === "audio" ? (
                                            <div className="media-gallery__img-placeholder">
                                                🎵
                                            </div>
                                        ) : (
                                            <div className="media-gallery__img-placeholder">
                                                📎
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}
