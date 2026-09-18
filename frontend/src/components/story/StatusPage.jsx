import { useEffect, useState } from "react";

import "./StatusPage.css";

import { useAuth } from "../../context/AuthContext";
import { useChatSocket } from "../../context/ChatSocketContext";
import UserAvatar from "../UserAvatar";
import { useAndroidBack } from "../../utils/androidBack";
import StoryComposer from "./StoryComposer";
import StoryViewer from "./StoryViewer";

// ==========================================================
// StatusPage — dedicated full-page section for 24h statuses
//
// Opened from the sidebar ("Status"). Shows your own status
// card first (post or view), then every friend who posted
// in the last 24h as a tappable row. Upload and viewing
// reuse StoryComposer / StoryViewer.
// ==========================================================

function PlusIcon() {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
        >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
        </svg>
    );
}

function EyeIcon() {
    return (
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
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

export default function StatusPage() {

    const { user } = useAuth();

    const {
        stories,
        refreshStories,
    } = useChatSocket();

    const [composerOpen, setComposerOpen] =
        useState(false);

    const [viewerGroup, setViewerGroup] =
        useState(null);

    // Android back button: close the story composer/viewer
    // before letting the press bubble to the tab layer.
    useAndroidBack(() => {

        if (composerOpen) {
            setComposerOpen(false);
            return true;
        }

        if (viewerGroup) {
            setViewerGroup(null);
            return true;
        }

        return false;

    }, Boolean(composerOpen || viewerGroup));

    // Load the feed on mount (and after reconnect
    // events handled by the provider).
    useEffect(() => {

        void refreshStories();

    }, []);

    if (!user) return null;

    const myGroup =
        stories.find(
            group => group.user_id === user.id
        );

    const friendGroups =
        stories.filter(
            group => group.user_id !== user.id
        );

    const myStories =
        myGroup?.stories ?? [];

    const hasMyStories =
        myStories.length > 0;

    const latestMine =
        hasMyStories
            ? myStories[myStories.length - 1]
            : null;

    const totalViews =
        myStories.reduce(
            (sum, story) =>
                sum + (story.view_count ?? 0),
            0,
        );

    return (

        <div className="status-page stage-panel">

            {/* ---------------- header ---------------- */}

            <div className="status-header">

                <div>

                    <h2>Status</h2>

                    <p>
                        Photo and video updates that
                        disappear after 24 hours.
                        End-to-end encrypted, like
                        everything else.
                    </p>

                </div>

                <button
                    type="button"
                    className="status-add-btn"
                    onClick={() =>
                        setComposerOpen(true)
                    }
                >
                    <PlusIcon />
                    Add status
                </button>

            </div>

            {/* ---------------- my status ---------------- */}

            <h3 className="status-section-title">
                My status
            </h3>

            <div className="status-my-card">

                <button
                    type="button"
                    className={
                        hasMyStories
                            ? "status-ring mine has-stories"
                            : "status-ring mine"
                    }
                    onClick={() => {

                        if (hasMyStories) {

                            setViewerGroup(myGroup);

                        }
                        else {

                            setComposerOpen(true);

                        }

                    }}
                    title="My status"
                >
                    <span className="status-ring-avatar">
                        <UserAvatar
                            user={user}
                            className="status-ring-user-avatar"
                        />
                        <span className="status-ring-add">
                            +
                        </span>
                    </span>
                </button>

                <div className="status-my-meta">

                    <span className="status-my-name">
                        My status
                    </span>

                    {hasMyStories ? (

                        <span className="status-my-sub">
                            {myStories.length}{" "}
                            {myStories.length === 1
                                ? "update"
                                : "updates"}{" "}
                            · {formatTime(latestMine?.created_at)}
                            {" "}· {totalViews}{" "}
                            {totalViews === 1
                                ? "view"
                                : "views"}
                        </span>

                    ) : (

                        <span className="status-my-sub">
                            Tap to add a status update
                        </span>

                    )}

                </div>

                {hasMyStories && (

                    <button
                        type="button"
                        className="status-view-btn"
                        onClick={() =>
                            setViewerGroup(myGroup)
                        }
                    >
                        <EyeIcon />
                        View
                    </button>

                )}

            </div>

            {/* ---------------- recent updates ---------------- */}

            <h3 className="status-section-title">
                Recent updates
            </h3>

            {friendGroups.length === 0 ? (

                <div className="status-empty">

                    <div className="status-empty-icon">

                        <svg
                            width="26"
                            height="26"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 2" />
                        </svg>

                    </div>

                    <p className="status-empty-title">
                        No recent updates
                    </p>

                    <p className="status-empty-sub">
                        When friends post a status it will
                        show up here.
                    </p>

                </div>

            ) : (

                <div className="status-list">

                    {friendGroups.map(group => {

                        const latest =
                            group.stories[
                                group.stories.length - 1
                            ];

                        const unviewed =
                            group.stories.some(
                                story => !story.viewed
                            );

                        return (

                            <button
                                key={group.user_id}
                                type="button"
                                className={
                                    unviewed
                                        ? "status-row has-unviewed"
                                        : "status-row"
                                }
                                onClick={() =>
                                    setViewerGroup(group)
                                }
                            >

                                <span className="status-row-avatar">
                                    <UserAvatar
                                        user={group.owner}
                                        className={
                                            unviewed
                                                ? "status-avatar-img seen-ring"
                                                : "status-avatar-img"
                                        }
                                    />
                                </span>

                                <span className="status-row-meta">

                                    <span className="status-row-name">
                                        {group.owner?.display_name ??
                                            "Unknown"}
                                    </span>

                                    <span className="status-row-sub">
                                        {formatTime(latest?.created_at)}
                                        {" · "}
                                        {group.stories.length}{" "}
                                        {group.stories.length === 1
                                            ? "update"
                                            : "updates"}
                                    </span>

                                </span>

                                {latest?.media_type === "video" && (

                                    <svg
                                        className="status-row-kind"
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                    >
                                        <path d="M8 5v14l11-7z" />
                                    </svg>

                                )}

                            </button>

                        );

                    })}

                </div>

            )}

            {/* ---------------- overlays ---------------- */}

            {composerOpen && (
                <StoryComposer
                    onClose={() =>
                        setComposerOpen(false)
                    }
                    onPosted={(group) => {

                        setComposerOpen(false);

                        setViewerGroup(group);

                    }}
                />
            )}

            {viewerGroup && (
                <StoryViewer
                    group={viewerGroup}
                    onClose={() =>
                        setViewerGroup(null)
                    }
                    onGroupUpdated={setViewerGroup}
                />
            )}

        </div>

    );

}

function formatTime(value) {

    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    const minutes = Math.max(
        0,
        Math.round((Date.now() - date.getTime()) / 60000)
    );

    if (minutes < 1) return "Just now";

    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);

    if (hours < 24) return `${hours}h ago`;

    return `${Math.floor(hours / 24)}d ago`;

}
