import { useModalAnimation } from "../../hooks/useModalAnimation";

import PresencePet from "../PresencePet";
import UserAvatar from "../UserAvatar";

// ==========================================================
// Contact info sheet (WhatsApp-style).
//
// Tapping the chat header's name/avatar in a private chat opens
// this. Shows the peer's identity as the conversation knows it
// (display name, username, online status) without a dedicated
// profile endpoint — the conversation header already carries
// everything we display.
// ==========================================================

export default function ContactProfileModal({ user, onClose }) {

    const { contentRef } = useModalAnimation();

    const online =
        user?.online_status === "online";

    const pet =
        user?.presence_animal &&
        user.presence_animal !== "default"
            ? user.presence_animal
            : null;

    return (

        <div
            className="modal-overlay"
            onClick={onClose}
        >

            <div
                ref={contentRef}
                className="modal-card contact-profile"
                role="dialog"
                aria-modal="true"
                aria-label={user?.display_name ?? "Contact"}
                onClick={(event) =>
                    event.stopPropagation()
                }
            >

                <UserAvatar
                    user={user}
                    className="contact-profile-avatar"
                />

                <h3 className="contact-profile-name">
                    {user?.display_name || "Unknown"}
                </h3>

                {user?.username && (
                    <p className="contact-profile-username">
                        @{user.username}
                    </p>
                )}

                <div className="contact-profile-status">
                    <span className={`dot ${online ? "online" : ""}`} />
                    {online ? "Online" : "Offline"}
                </div>

                {pet && (
                    <div className="contact-profile-pet">
                        <PresencePet
                            style={pet}
                            className="pp-pet"
                        />
                        <span>
                            {pet}
                        </span>
                    </div>
                )}

                <div className="contact-profile-actions">
                    <button
                        type="button"
                        className="btn-ghost"
                        onClick={onClose}
                    >
                        Close
                    </button>
                </div>

            </div>

        </div>

    );

}