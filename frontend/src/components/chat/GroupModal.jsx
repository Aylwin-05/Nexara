import {
    useEffect,
    useState,
} from "react";
import toast from "react-hot-toast";

import { getApiErrorDetail } from "../../utils/errors";
import UserAvatar from "../UserAvatar";

import friendService from "../../services/friendService";
import conversationService from "../../services/conversationService";

import { useModalAnimation } from "../../hooks/useModalAnimation";

import "./GroupModal.css";

export default function GroupModal({
    onClose,
    onCreate,
}) {

    const [name, setName] =
        useState("");

    const [friends, setFriends] =
        useState([]);

    const [selected, setSelected] =
        useState([]);

    const [busy, setBusy] =
        useState(false);

    const [loadingFriends, setLoadingFriends] =
        useState(true);

    const { contentRef } = useModalAnimation();

    useEffect(() => {

        let active = true;

        friendService.getFriends()
            .then(data => {

                if (active) setFriends(data);

            })
            .catch(error => {

                console.error(
                    "Failed to load friends for group",
                    error
                );

            })
            .finally(() => {

                if (active) setLoadingFriends(false);

            });

        return () => {
            active = false;
        };

    }, []);

    function toggleMember(member) {

        setSelected(previous => {

            const exists =
                previous.some(
                    item => item.id === member.id
                );

            if (exists) {

                return previous.filter(
                    item => item.id !== member.id
                );

            }

            return [...previous, member];

        });

    }

    async function handleCreate() {

        if (!name.trim()) {

            toast.error(
                "Give the group a name."
            );

            return;

        }

        if (selected.length === 0) {

            toast.error(
                "Select at least one member."
            );

            return;

        }

        setBusy(true);

        try {

            const group =
                await conversationService.createGroup(
                    name.trim(),
                    selected.map(
                        member => member.id
                    ),
                );

            toast.success(
                "Group created. "
                + "Messages are end-to-end encrypted."
            );

            onCreate?.(group);

            onClose();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to create the group."));

        }
        finally {

            setBusy(false);

        }

    }

    const friendList = Array.isArray(friends)
        ? friends
        : [];

    return (

        <div className="modal-backdrop" onMouseDown={onClose}>

            <div
                ref={contentRef}
                className="group-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Create group"
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

                    <h3>New group</h3>

                </div>

                <div className="group-modal-body">

                    <input
                        className="group-name-input"
                        type="text"
                        placeholder="Group name"
                        maxLength={100}
                        value={name}
                        onChange={e =>
                            setName(e.target.value)
                        }
                        autoFocus
                    />

                    <div className="group-member-picker-label">
                        Members
                        <span className="group-member-count">
                            {selected.length} selected
                        </span>
                    </div>

                    <div className="group-friend-list">

                        {loadingFriends ? (

                            <div className="group-empty-state">
                                Loading friends…
                            </div>

                        ) : friendList.length === 0 ? (

                            <div className="group-empty-state">
                                No friends yet. Add friends
                                before creating a group.
                            </div>

                        ) : (
                            friendList.map(friend => {

                                const other =
                                    friend.sender?.id ===
                                        friend.receiver_id
                                        ? friend.receiver
                                        : friend.sender;

                                const checked =
                                    selected.some(
                                        item =>
                                            item.id ===
                                            other.id
                                    );

                                return (

                                    <button
                                        key={other.id}
                                        type="button"
                                        className={
                                            checked
                                                ? "group-friend-item selected"
                                                : "group-friend-item"
                                        }
                                        onClick={() =>
                                            toggleMember(other)
                                        }
                                    >

                                        <UserAvatar
                                            user={other}
                                            className="group-friend-avatar"
                                        />

                                        <span className="group-friend-name">
                                            {other.display_name ||
                                                other.username ||
                                                "Unknown"}
                                        </span>

                                        {checked && (
                                            <span className="group-friend-check">
                                                ✓
                                            </span>
                                        )}

                                    </button>

                                );

                            })
                        )}

                    </div>

                </div>

                <div className="group-modal-footer">

                    <button
                        type="button"
                        className="btn-ghost"
                        onClick={onClose}
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        className="btn-primary"
                        disabled={
                            busy ||
                            !name.trim() ||
                            selected.length === 0
                        }
                        onClick={handleCreate}
                    >
                        {busy
                            ? "Creating…"
                            : "Create group"}
                    </button>

                </div>

            </div>

        </div>

    );

}