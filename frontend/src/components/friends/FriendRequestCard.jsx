import { avatarGradient, initials } from "../../utils/avatar";

export default function FriendRequestCard({
    request,
    onAccept,
    onReject,
}) {

    const senderName =
        request?.sender?.display_name ??
        request?.sender_id ??
        "Unknown";

    return (
        <div className="f-card">
            <div
                className="f-avatar"
                style={{
                    background: avatarGradient(senderName),
                }}
            >
                {initials(
                    request?.sender?.display_name ?? "?"
                )}
            </div>

            <div className="f-meta">
                <strong>{senderName}</strong>
                <small>Wants to chat with you</small>
            </div>

            <div className="f-actions">
                {typeof onAccept === "function" && (
                    <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => onAccept(request.id)}
                    >
                        Accept
                    </button>
                )}

                {typeof onReject === "function" && (
                    <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => onReject(request.id)}
                    >
                        Reject
                    </button>
                )}
            </div>
        </div>
    );
}
