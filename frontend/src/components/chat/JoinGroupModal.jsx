import { useState } from "react";
import toast from "react-hot-toast";

import { getApiErrorDetail } from "../../utils/errors";
import conversationService from "../../services/conversationService";

import "./GroupModal.css";

// ==========================================================
// Join a group by pasting an invite link (or bare token).
// ==========================================================

function extractToken(input) {

    const trimmed = (input || "").trim();

    // Full URL form: https://host/join/<token>
    if (trimmed.includes("/")) {

        return trimmed
            .replace(/\/+$/, "")
            .split("/")
            .pop()
            .trim();

    }

    return trimmed;

}

export default function JoinGroupModal({
    onClose,
    onJoined,
}) {

    const [input, setInput] = useState("");

    const [busy, setBusy] = useState(false);

    async function handleJoin() {

        const token = extractToken(input);

        if (!token) {

            toast.error(
                "Paste the invite link or its token."
            );

            return;

        }

        setBusy(true);

        try {

            const result =
                await conversationService.joinGroupWithLink(
                    token
                );

            toast.success(
                result.status === "already_member"
                    ? "You are already a member of this group."
                    : `Joined ${result.name || "the group"}.`
            );

            onJoined?.({
                id: result.conversation_id,
                conversation_type: "group",
                name: result.name,
                ...result,
            });

            onClose();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to join the group."));

        }
        finally {

            setBusy(false);

        }

    }

    return (

        <div className="modal-backdrop" onMouseDown={onClose}>

            <div
                className="group-modal"
                onMouseDown={e => e.stopPropagation()}
            >

                <div className="modal-head">

                    <button
                        type="button"
                        className="modal-close"
                        aria-label="Close"
                        onClick={onClose}
                    >
                        ✕
                    </button>

                    <h3>Join a group</h3>

                </div>

                <div className="join-group-body">

                    <p className="join-group-hint">
                        Paste the invite link someone shared with
                        you. You'll join the group immediately.
                    </p>

                    <input
                        type="text"
                        className="group-info-input"
                        placeholder="https://…/join/… or token"
                        autoFocus
                        value={input}
                        onChange={event =>
                            setInput(event.target.value)
                        }
                        onKeyDown={event => {

                            if (event.key === "Enter") {

                                handleJoin();

                            }

                        }}
                    />

                    <div className="join-group-actions">

                        <button
                            type="button"
                            className="btn-primary"
                            disabled={busy}
                            onClick={handleJoin}
                        >
                            {busy
                                ? "Joining…"
                                : "Join group"}
                        </button>

                        <button
                            type="button"
                            className="btn-ghost"
                            onClick={onClose}
                        >
                            Cancel
                        </button>

                    </div>

                </div>

            </div>

        </div>

    );

}