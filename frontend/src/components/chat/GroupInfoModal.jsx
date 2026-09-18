import {
    useEffect,
    useRef,
    useState,
} from "react";
import toast from "react-hot-toast";
import { getApiErrorDetail } from "../../utils/errors";
import { useAuth } from "../../context/AuthContext";

import UserAvatar from "../UserAvatar";

import friendService from "../../services/friendService";
import conversationService from "../../services/conversationService";
import { getConfiguredServer } from "../../api/api";

import "./GroupModal.css";
import "./GroupInfoModal.css";

// ==========================================================
// Flat participant -> user-ish object (backend returns flat
// fields; some callers expect a nested `user`).
// ==========================================================

function memberUser(participant) {

    if (participant?.user) return participant.user;

    return {
        id: participant?.user_id,
        display_name: participant?.display_name,
        username: participant?.username,
        avatar_url: participant?.avatar_url,
        online_status: participant?.online_status,
    };

}

export default function GroupInfoModal({
    conversation,
    groupDetail,
    onClose,
    onUpdated,
    onLeave,
}) {

    const { user } = useAuth();

    const [friends, setFriends] =
        useState([]);

    const [showPicker, setShowPicker] =
        useState(false);

    const [selected, setSelected] =
        useState([]);

    const [busy, setBusy] =
        useState(false);

    // Edit group name / description (admin only)
    const [editMode, setEditMode] =
        useState(false);

    const [nameDraft, setNameDraft] =
        useState("");

    const [descDraft, setDescDraft] =
        useState("");

    // Avatar upload (admin only)
    const [uploadingAvatar, setUploadingAvatar] =
        useState(false);

    const avatarInputRef = useRef(null);

    // Invite link (admin only)
    const [inviteLink, setInviteLink] =
        useState(null);

    const [inviteBusy, setInviteBusy] =
        useState(false);

    const [inviteCopied, setInviteCopied] =
        useState(false);

    useEffect(() => {

        if (!isAdmin) return;

        let active = true;

        conversationService.getInviteLink(conversation.id)
            .then(link => {

                if (active) setInviteLink(link);

            })
            .catch(error => {

                console.error(
                    "Failed to load invite link",
                    error
                );

            });

        return () => {
            active = false;
        };

    }, [conversation.id, isAdmin]);

    const participants =
        groupDetail?.participants ?? [];

    const isAdmin =
        participants.some(
            participant =>
                participant.user_id ===
                    user?.id &&
                participant.is_admin
        );

    const groupAvatar =
        groupDetail?.avatar_url ??
        conversation?.avatar_url;

    useEffect(() => {

        if (!showPicker) return;

        let active = true;

        friendService.getFriends()
            .then(data => {

                if (active) setFriends(data);

            })
            .catch(error => {

                console.error(
                    "Failed to load friends",
                    error
                );

            });

        return () => {
            active = false;
        };

    }, [showPicker]);

    function startEdit() {

        setNameDraft(
            groupDetail?.name ??
            conversation?.name ??
            ""
        );

        setDescDraft(
            groupDetail?.description ?? ""
        );

        setEditMode(true);

    }

    async function handleSaveInfo() {

        const fields = {};

        if (
            nameDraft.trim() !==
            (groupDetail?.name ?? "")
        ) {
            fields.name = nameDraft.trim();
        }

        if (
            (descDraft.trim() || null) !==
            (groupDetail?.description ?? null)
        ) {
            fields.description = descDraft.trim();
        }

        if (Object.keys(fields).length === 0) {

            setEditMode(false);

            return;

        }

        setBusy(true);

        try {

            await conversationService.updateGroup(
                conversation.id,
                fields,
            );

            toast.success("Group info updated.");

            setEditMode(false);

            onUpdated?.();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to update group."));

        }
        finally {

            setBusy(false);

        }

    }

    async function handleAvatarChange(event) {

        const file = event.target.files?.[0];

        if (!file) return;

        setUploadingAvatar(true);

        try {

            const result =
                await conversationService.uploadGroupAvatar(
                    conversation.id,
                    file,
                );

            toast.success("Group photo updated.");

            onUpdated?.();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to upload group photo."));

        }
        finally {

            setUploadingAvatar(false);

            event.target.value = "";

        }

    }

    async function handleAddMembers() {

        if (selected.length === 0) return;

        setBusy(true);

        try {

            await conversationService.addGroupMembers(
                conversation.id,
                selected.map(member => member.id)
            );

            toast.success(
                "Members added. "
                + "Their sessions were re-encrypted."
            );

            setSelected([]);

            setShowPicker(false);

            onUpdated?.();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to add members."));

        }
        finally {

            setBusy(false);

        }

    }

    async function handleRemoveMember(memberId) {

        if (
            !window.confirm(
                "Remove this member from the group?"
            )
        ) return;

        setBusy(true);

        try {

            await conversationService.removeGroupMember(
                conversation.id,
                memberId,
            );

            toast.success("Member removed.");

            onUpdated?.();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to remove member."));

        }
        finally {

            setBusy(false);

        }

    }

    async function handleToggleAdmin(memberId, makeAdmin) {

        setBusy(true);

        try {

            await conversationService.setGroupAdmin(
                conversation.id,
                memberId,
                makeAdmin,
            );

            toast.success(
                makeAdmin
                    ? "Member is now an admin."
                    : "Admin role removed."
            );

            onUpdated?.();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to change admin role."));

        }
        finally {

            setBusy(false);

        }

    }

    function inviteUrl(token) {

        const configured = getConfiguredServer();

        const base =
            configured || window.location.origin;

        return `${base}/join/${token}`;

    }

    async function handleCreateInvite() {

        setInviteBusy(true);

        try {

            const link =
                await conversationService.createInviteLink(
                    conversation.id
                );

            setInviteLink(link);

            toast.success(
                "Invite link created. "
                + "Anyone with it can join the group."
            );

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to create invite link."));

        }
        finally {

            setInviteBusy(false);

        }

    }

    async function handleRevokeInvite() {

        if (
            !window.confirm(
                "Revoke this invite link? "
                + "People with it will no longer be able to join."
            )
        ) return;

        setInviteBusy(true);

        try {

            await conversationService.revokeInviteLink(
                conversation.id
            );

            setInviteLink(null);

            toast.success("Invite link revoked.");

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to revoke invite link."));

        }
        finally {

            setInviteBusy(false);

        }

    }

    async function handleCopyInvite() {

        if (!inviteLink?.token) return;

        try {

            await navigator.clipboard.writeText(
                inviteUrl(inviteLink.token)
            );

            setInviteCopied(true);

            setTimeout(() => setInviteCopied(false), 2000);

        }
        catch (error) {

            toast.error("Unable to copy the link.");

        }

    }

    async function handleLeave() {

        setBusy(true);

        try {

            await conversationService.leaveGroup(
                conversation.id
            );

            toast.success(
                "You left the group."
            );

            onLeave?.();

            onClose();

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to leave the group."));

        }
        finally {

            setBusy(false);

        }

    }

    const friendList = Array.isArray(friends)
        ? friends
        : [];

    const friendsToAdd =
        friendList.filter(friend => {

            const other =
                friend.sender?.id ===
                    friend.receiver_id
                    ? friend.receiver
                    : friend.sender;

            return !participants.some(
                participant =>
                    participant.user_id === other?.id
            );

        });

    return (

        <div className="modal-backdrop" onMouseDown={onClose}>

            <div
                className="group-info-modal"
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

                    <h3>Group info</h3>

                </div>

                <div className="group-info-body">

                    <div className="group-info-hero">

                        {groupAvatar ? (

                            <img
                                src={groupAvatar}
                                alt="Group"
                                className="group-info-avatar-img"
                                onClick={() => {
                                    if (isAdmin) {
                                        avatarInputRef
                                            .current
                                            ?.click();
                                    }
                                }}
                            />

                        ) : (

                            <div
                                className="group-info-avatar"
                                onClick={() => {
                                    if (isAdmin) {
                                        avatarInputRef
                                            .current
                                            ?.click();
                                    }
                                }}
                            >
                                {(
                                    groupDetail?.name ??
                                    conversation?.name ??
                                    "?"
                                ).slice(0, 1).toUpperCase()}
                            </div>

                        )}

                        <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            hidden
                            onChange={handleAvatarChange}
                        />

                        <strong className="group-info-name">
                            {groupDetail?.name ??
                                conversation?.name}
                        </strong>

                        {groupDetail?.description && (
                            <span className="group-info-desc">
                                {groupDetail.description}
                            </span>
                        )}

                        <span className="group-info-count">
                            {participants.length} members
                        </span>

                        {isAdmin && !editMode && (
                            <div className="group-info-actions">
                                <button
                                    type="button"
                                    className="group-info-edit-btn"
                                    onClick={startEdit}
                                >
                                    Edit name & description
                                </button>
                                <button
                                    type="button"
                                    className="group-info-edit-btn"
                                    disabled={uploadingAvatar}
                                    onClick={() =>
                                        avatarInputRef
                                            .current
                                            ?.click()
                                    }
                                >
                                    {uploadingAvatar
                                        ? "Uploading…"
                                        : groupAvatar
                                            ? "Change photo"
                                            : "Add photo"}
                                </button>
                            </div>
                        )}

                        {editMode && isAdmin && (
                            <div className="group-info-edit-form">
                                <input
                                    type="text"
                                    className="group-info-input"
                                    maxLength={100}
                                    placeholder="Group name"
                                    value={nameDraft}
                                    onChange={event =>
                                        setNameDraft(
                                            event.target.value
                                        )
                                    }
                                />
                                <textarea
                                    className="group-info-input"
                                    maxLength={500}
                                    rows={2}
                                    placeholder="Group description"
                                    value={descDraft}
                                    onChange={event =>
                                        setDescDraft(
                                            event.target.value
                                        )
                                    }
                                />
                                <div className="group-info-edit-btns">
                                    <button
                                        type="button"
                                        className="btn-primary"
                                        disabled={busy}
                                        onClick={handleSaveInfo}
                                    >
                                        {busy
                                            ? "Saving…"
                                            : "Save"}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-ghost"
                                        onClick={() =>
                                            setEditMode(false)
                                        }
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}

                    </div>

                    {isAdmin && (

                        <div className="group-info-section">

                            <div className="group-info-section-head">

                                <span className="group-info-section-title">
                                    Invite via link
                                </span>

                                {!inviteLink && (
                                    <button
                                        type="button"
                                        className="group-info-add-btn"
                                        disabled={inviteBusy}
                                        onClick={handleCreateInvite}
                                    >
                                        {inviteBusy
                                            ? "Creating…"
                                            : "+ Create link"}
                                    </button>
                                )}

                            </div>

                            {inviteLink ? (
                                <div className="invite-link-box">

                                    <span className="invite-link-text">

                                        {inviteUrl(inviteLink.token)}

                                    </span>

                                    <div className="invite-link-actions">

                                        <button
                                            type="button"
                                            className="group-member-btn"
                                            disabled={inviteBusy}
                                            onClick={handleCopyInvite}
                                        >
                                            {inviteCopied
                                                ? "Copied!"
                                                : "Copy link"}
                                        </button>

                                        <button
                                            type="button"
                                            className="group-member-btn danger"
                                            disabled={inviteBusy}
                                            onClick={handleRevokeInvite}
                                        >
                                            Revoke
                                        </button>

                                    </div>

                                    <span className="invite-link-note">
                                        Anyone with this link can join
                                        the group. A new link replaces
                                        the previous one.
                                    </span>

                                </div>
                            ) : (
                                !inviteBusy && (
                                    <span className="invite-link-note">
                                        No invite link yet. Create one
                                        to let anyone join the group.
                                    </span>
                                )
                            )}

                        </div>

                    )}

                    <div className="group-info-section">

                        <div className="group-info-section-head">

                            <span className="group-info-section-title">
                                Members
                            </span>

                            {isAdmin && (
                                <button
                                    type="button"
                                    className="group-info-add-btn"
                                    onClick={() =>
                                        setShowPicker(
                                            previous =>
                                                !previous
                                        )
                                    }
                                >
                                    {showPicker
                                        ? "Cancel"
                                        : "+ Add members"}
                                </button>
                            )}

                        </div>

                        {showPicker && isAdmin && (
                            <div className="group-add-picker">

                                {friendsToAdd.length ===
                                0 ? (
                                    <div className="group-empty-state">
                                        No friends left to
                                        add.
                                    </div>
                                ) : (
                                    friendsToAdd.map(
                                        friend => {

                                            const other =
                                                friend.sender
                                                    ?.id ===
                                                    friend.receiver_id
                                                    ? friend
                                                          .receiver
                                                    : friend
                                                          .sender;

                                            const checked =
                                                selected.some(
                                                    item =>
                                                        item.id ===
                                                        other?.id
                                                );

                                            return (

                                                <button
                                                    key={other?.id}
                                                    type="button"
                                                    className={
                                                        checked
                                                            ? "group-add-item selected"
                                                            : "group-add-item"
                                                    }
                                                    onClick={() => {

                                                        if (!other) return;

                                                        setSelected(
                                                            previous =>
                                                                previous.some(
                                                                    item =>
                                                                        item.id ===
                                                                        other.id
                                                                )
                                                                    ? previous.filter(
                                                                          item =>
                                                                              item.id !==
                                                                              other.id
                                                                      )
                                                                    : [
                                                                          ...previous,
                                                                          other,
                                                                      ]
                                                        );

                                                    }}
                                                >

                                                    <UserAvatar
                                                        user={other}
                                                        className="group-friend-avatar"
                                                    />

                                                    <span className="group-friend-name">
                                                        {other?.display_name ??
                                                            other?.username ??
                                                            "Unknown"}
                                                    </span>

                                                    {checked && (
                                                        <span className="group-friend-check">
                                                            ✓
                                                        </span>
                                                    )}

                                                </button>

                                            );

                                        }
                                    )
                                )}

                                <button
                                    type="button"
                                    className="btn-primary group-add-confirm"
                                    disabled={
                                        busy ||
                                        selected.length === 0
                                    }
                                    onClick={handleAddMembers}
                                >
                                    {busy
                                        ? "Adding…"
                                        : `Add ${selected.length}`}
                                </button>

                            </div>
                        )}

                        <div className="group-members-list">

                            {participants.map(
                                participant => {

                                    const member =
                                        memberUser(participant);

                                    const isMe =
                                        participant.user_id ===
                                        user?.id;

                                    const isCreator =
                                        participant.user_id ===
                                        groupDetail?.created_by;

                                    return (

                                        <div
                                            key={
                                                participant.user_id
                                            }
                                            className="group-member-item"
                                        >

                                            <UserAvatar
                                                user={member}
                                                className="group-member-avatar"
                                            />

                                            <div className="group-member-meta">

                                                <strong>
                                                    {member.display_name ??
                                                        member.username ??
                                                        "Unknown"}
                                                </strong>

                                                {isMe && (
                                                    <span className="group-member-me">
                                                        (you)
                                                    </span>
                                                )}

                                                {isCreator && (
                                                    <span className="group-member-creator">
                                                        creator
                                                    </span>
                                                )}

                                            </div>

                                            {participant.is_admin && (
                                                <span className="group-admin-badge">
                                                    admin
                                                </span>
                                            )}

                                            {isAdmin &&
                                            !isMe &&
                                            !isCreator && (
                                                <div className="group-member-controls">
                                                    {!participant.is_admin && (
                                                        <button
                                                            type="button"
                                                            className="group-member-btn"
                                                            disabled={busy}
                                                            title="Make admin"
                                                            onClick={() =>
                                                                handleToggleAdmin(
                                                                    participant.user_id,
                                                                    true,
                                                                )
                                                            }
                                                        >
                                                            Make admin
                                                        </button>
                                                    )}
                                                    {participant.is_admin && (
                                                        <button
                                                            type="button"
                                                            className="group-member-btn"
                                                            disabled={busy}
                                                            title="Remove admin"
                                                            onClick={() =>
                                                                handleToggleAdmin(
                                                                    participant.user_id,
                                                                    false,
                                                                )
                                                            }
                                                        >
                                                            Demote
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="group-member-btn danger"
                                                        disabled={busy}
                                                        title="Remove member"
                                                        onClick={() =>
                                                            handleRemoveMember(
                                                                participant.user_id
                                                            )
                                                        }
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            )}

                                        </div>

                                    );

                                }
                            )}

                        </div>

                    </div>

                </div>

                <div className="group-info-footer">

                    <button
                        type="button"
                        className="btn-danger-ghost"
                        disabled={busy}
                        onClick={handleLeave}
                    >
                        Leave group
                    </button>

                </div>

            </div>

        </div>

    );

}