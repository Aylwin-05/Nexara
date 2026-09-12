import { useState } from "react";
import toast from "react-hot-toast";

import { getApiErrorDetail } from "../../utils/errors";
import { useAuth } from "../../context/AuthContext";
import { useChatSocket } from "../../context/ChatSocketContext";
import { useModalAnimation } from "../../hooks/useModalAnimation";

import "./DeleteConversationModal.css";

function TrashIcon() {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M10 11v6M14 11v6" />
        </svg>
    );
}

// ==========================================================
// Two-party conversation deletion modal.
//
// Three phases, driven by the conversation's pending-delete
// state (which users see through GET /conversations and the
// real-time WS events):
//
//   initiate: "Delete chat?"          -> request consent
//   waiting:  my request, unanswered  -> cancel it
//   pending:  THEY requested          -> confirm or "Not now"
// ==========================================================

export default function DeleteConversationModal({
    conversation,
    onClose,
}) {

    const { user } = useAuth();

    const {
        requestConversationDelete,
        confirmConversationDelete,
        cancelConversationDelete,
    } = useChatSocket();

    const [busy, setBusy] = useState(false);

    const { contentRef } = useModalAnimation();

    if (!conversation) return null;

    const otherUser =
        conversation.other_user ?? {
            display_name: "Unknown User",
            username: "unknown",
        };

    const otherName =
        otherUser.display_name ||
        otherUser.username ||
        "this user";

    const requestedByMe =
        Boolean(
            conversation.delete_requested_by &&
            conversation.delete_requested_by ===
                user?.id
        );

    const waitingForOther =
        Boolean(conversation.delete_requested_by) &&
        !requestedByMe;

    // ==========================================================
    // Actions
    // ==========================================================

    async function handleRequest() {

        if (busy) return;

        setBusy(true);

        try {

            const data =
                await requestConversationDelete(
                    conversation.id
                );

            if (data.status === "deleted") {

                toast.success("Chat deleted.");

                onClose();

                return;

            }

            toast.success(
                `Deletion requested. Waiting for ${otherName} to confirm.`
            );

            onClose();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to request deletion."));

        }
        finally {

            setBusy(false);

        }

    }

    async function handleConfirm() {

        if (busy) return;

        setBusy(true);

        try {

            const data =
                await confirmConversationDelete(
                    conversation.id
                );

            if (data.status === "deleted") {

                toast.success("Chat deleted.");

            }

            onClose();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to delete this chat."));

        }
        finally {

            setBusy(false);

        }

    }

    async function handleDismiss() {

        // "Not now": wipe the pending request entirely so
        // nobody is left hanging in limbo.
        if (busy) return;

        setBusy(true);

        try {

            await cancelConversationDelete(
                conversation.id
            );

            onClose();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to dismiss the request."));

        }
        finally {

            setBusy(false);

        }

    }

    async function handleCancelRequest() {

        if (busy) return;

        setBusy(true);

        try {

            await cancelConversationDelete(
                conversation.id
            );

            toast.success("Deletion request cancelled.");

            onClose();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to cancel the request."));

        }
        finally {

            setBusy(false);

        }

    }

    // ==========================================================
    // Render
    // ==========================================================

    return (

        <div
            className="modal-overlay"
            onClick={onClose}
        >

            <div
                ref={contentRef}
                className="delete-conv-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Delete conversation"
                onClick={(event) =>
                    event.stopPropagation()
                }
            >

                <div className="delete-conv-modal-icon">

                    <TrashIcon />

                </div>

                {waitingForOther ? (

                    // ----------------------------------------
                    // THEY asked to delete
                    // ----------------------------------------

                    <>

                        <h3>Delete this chat?</h3>

                        <p className="delete-conv-modal-body">

                            {otherName} wants to delete this
                            chat for both of you. All messages
                            and media will be permanently
                            removed from the server. This
                            can't be undone.

                        </p>

                        <div className="delete-conv-actions">

                            <button
                                type="button"
                                className="btn-ghost"
                                disabled={busy}
                                onClick={handleDismiss}
                            >
                                Not now
                            </button>

                            <button
                                type="button"
                                className="btn-danger"
                                disabled={busy}
                                onClick={handleConfirm}
                            >
                                {busy
                                    ? "Deleting…"
                                    : "Delete both"}
                            </button>

                        </div>

                    </>

                ) : requestedByMe ? (

                    // ----------------------------------------
                    // MY request, still unanswered
                    // ----------------------------------------

                    <>

                        <h3>Waiting for confirmation</h3>

                        <p className="delete-conv-modal-body">

                            {otherName} hasn't confirmed yet.
                            Nothing has been deleted so far —
                            the wipe happens only once both of
                            you consent.

                        </p>

                        <div className="delete-conv-actions">

                            <button
                                type="button"
                                className="btn-ghost"
                                disabled={busy}
                                onClick={onClose}
                            >
                                Done
                            </button>

                            <button
                                type="button"
                                className="btn-danger"
                                disabled={busy}
                                onClick={handleCancelRequest}
                            >
                                Cancel request
                            </button>

                        </div>

                    </>

                ) : (

                    // ----------------------------------------
                    // First click: initiate
                    // ----------------------------------------

                    <>

                        <h3>Delete this chat?</h3>

                        <p className="delete-conv-modal-body">

                            This deletes the whole conversation
                            for both of you — every message and
                            every attachment, removed directly
                            from the server.

                        </p>

                        <p className="delete-conv-modal-note">

                            {otherName} will be asked to
                            confirm first. Nothing is deleted
                            until you both agree.

                        </p>

                        <div className="delete-conv-actions">

                            <button
                                type="button"
                                className="btn-ghost"
                                disabled={busy}
                                onClick={onClose}
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                className="btn-danger"
                                disabled={busy}
                                onClick={handleRequest}
                            >
                                {busy
                                    ? "Requesting…"
                                    : "Request deletion"}
                            </button>

                        </div>

                    </>

                )}

            </div>

        </div>

    );

}