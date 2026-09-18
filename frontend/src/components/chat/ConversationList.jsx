import { useState } from "react";

import "./ConversationList.css";

import ConversationItem from "./ConversationItem";
import GroupModal from "./GroupModal";
import JoinGroupModal from "./JoinGroupModal";

import { useChatSocket } from "../../context/ChatSocketContext";

export default function ConversationList({

    conversations,

    loading,

    selectedConversation,

    onSelectConversation,

    onGroupCreated,

    onJoined,

}) {

    const {
        presence,
        updateSettings,
    } = useChatSocket();

    const [showArchived, setShowArchived] =
        useState(false);

    const [groupModalOpen, setGroupModalOpen] =
        useState(false);

    const [joinModalOpen, setJoinModalOpen] =
        useState(false);

    if (loading) {

        return (

            <div className="conv-list">

                <div className="conv-panel-header">

                    <h2 className="conv-title">Chats</h2>

                </div>

            <div className="conv-list-body">

                    {[0, 1, 2, 3, 4, 5].map((index) => (

                        <div key={index} className="conv-skeleton">

                            <div className="skeleton conv-skeleton-avatar" />

                            <div className="conv-skeleton-lines">

                                <div className="skeleton" style={{ height: 12, width: "55%" }} />

                                <div className="skeleton" style={{ height: 10, width: "80%" }} />

                            </div>

                        </div>

                    ))}

                </div>

            </div>

        );

    }

    const activeConversations =
        conversations.filter(c => !c.is_archived);

    const archivedConversations =
        conversations.filter(c => c.is_archived);

    async function handleTogglePin(conversation) {

        await updateSettings(conversation.id, {
            is_pinned: !conversation.is_pinned,
        });

    }

    async function handleToggleMute(conversation) {

        // Quick mute toggle: mute for a week, or unmute.
        if (conversation.muted) {

            await updateSettings(conversation.id, {
                muted_until: null,
            });

            return;

        }

        const until = new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();

        await updateSettings(conversation.id, {
            muted_until: until,
        });

    }

    async function handleToggleArchive(conversation) {

        await updateSettings(conversation.id, {
            is_archived: !conversation.is_archived,
        });

    }

    const itemProps = (conversation) => ({

        conversation,

        online:
            presence[conversation.other_user?.id] ??
            conversation.other_user?.online_status ===
                "online",

        selected:
            selectedConversation?.id ===
            conversation.id,

        onSelect: onSelectConversation,

        onTogglePin: handleTogglePin,

        onToggleMute: handleToggleMute,

        onToggleArchive: handleToggleArchive,

    });

    return (

        <div className="conv-list">

            <div className="conv-panel-header">

                    <h2 className="conv-title">Chats</h2>

                    <div className="conv-header-actions">

                        <button
                            type="button"
                            className="conv-new-group-btn"
                            title="Join group via link"
                            onClick={() =>
                                setJoinModalOpen(true)
                            }
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                        </button>

                        <button
                            type="button"
                            className="conv-new-group-btn"
                            title="New group"
                            onClick={() =>
                                setGroupModalOpen(true)
                            }
                        >
                            +
                        </button>

                        <span className="conv-count">

                            {conversations.length}

                        </span>

                    </div>

                </div>

            <div className="conv-list-body">

                {

                    conversations.length === 0 && (

                        <div className="empty-state">

                            <div className="empty-icon">

                                <svg
                                    width="28"
                                    height="28"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                                </svg>

                            </div>

                            <h3>No conversations yet</h3>

                            <p>
                                Open your Friends tab and
                                start chatting with someone.
                            </p>

                        </div>

                    )

                }

                {

                    activeConversations.map(

                        (conversation) => (

                            <ConversationItem

                                key={conversation.id}

                                {...itemProps(conversation)}

                            />

                        )

                    )

                }

                {

                    archivedConversations.length > 0 && (

                        <div className="conv-archive-block">

                            <button
                                type="button"
                                className="conv-archive-toggle"
                                onClick={() =>
                                    setShowArchived(v => !v)
                                }
                            >
                                <span className="conv-archive-icon">

                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <rect x="2" y="3" width="20" height="5" rx="1" />
                                        <path d="M4 8v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
                                        <path d="M10 12h4" />
                                    </svg>

                                </span>

                                <span className="conv-archive-label">
                                    Archived
                                </span>

                                <span className="conv-archive-count">
                                    {archivedConversations.length}
                                </span>

                                <svg
                                    className={
                                        showArchived
                                            ? "conv-archive-chevron open"
                                            : "conv-archive-chevron"
                                    }
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="m6 9 6 6 6-6" />
                                </svg>

                            </button>

                            {showArchived && (

                                <div className="conv-archive-items">

                                    {

                                        archivedConversations.map(

                                            (conversation) => (

                                                <ConversationItem

                                                    key={conversation.id}

                                                    {...itemProps(conversation)}

                                                />

                                            )

                                        )

                                    }

                                </div>

                            )}

                        </div>

                    )

                }

            </div>

            {groupModalOpen && (

                <GroupModal

                    onClose={() =>
                        setGroupModalOpen(false)
                    }

                    onCreate={(group) =>
                        onGroupCreated?.(group)
                    }

                />

            )}

            {joinModalOpen && (

                <JoinGroupModal

                    onClose={() =>
                        setJoinModalOpen(false)
                    }

                    onJoined={(group) =>
                        onJoined?.(group)
                    }

                />

            )}

        </div>

    );

}