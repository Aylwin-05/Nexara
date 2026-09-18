import { avatarGradient, initials } from "../../utils/avatar";

export default function FriendCard({
    friend,
    onStartChat,
    onRemove,
}) {

    const displayName =
        friend?.display_name ?? friend?.name ?? "Unknown User";

    const email =
        friend?.email ?? friend?.username ?? "";

    return (
        <div className="f-card">
            <div
                className="f-avatar"
                style={{
                    background: avatarGradient(displayName),
                }}
            >
                {initials(displayName)}
            </div>

            <div className="f-meta">
                <strong>{displayName}</strong>
                <small>{email}</small>
            </div>

            <div className="f-actions">
                {typeof onStartChat === "function" && (
                    <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => onStartChat(friend)}
                    >
                        Chat
                    </button>
                )}

                {typeof onRemove === "function" && (
                    <button
                        type="button"
                        className="btn-ghost btn-sm danger"
                        onClick={() => onRemove(friend)}
                    >
                        Remove
                    </button>
                )}
            </div>
        </div>
    );
}
