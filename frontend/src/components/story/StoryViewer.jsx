import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import "./StoryViewer.css";

import { useAuth } from "../../context/AuthContext";
import { useChatSocket } from "../../context/ChatSocketContext";
import storyService from "../../services/storyService";

import UserAvatar from "../UserAvatar";

const STORY_DURATION_MS = 5000;

// ==========================================================
// StoryViewer — full-screen WhatsApp-style story player
//
// Shows one user's stories with animated progress bars,
// auto-advance, caption, viewer list (own stories) and
// delete (own stories). Media is fetched + decrypted in
// the browser (the server only ever sees ciphertext).
// ==========================================================

export default function StoryViewer({
    group,
    onClose,
    onGroupUpdated,
}) {

    const { user } = useAuth();

    const {
        markStoryViewed,
        deleteStory,
    } = useChatSocket();

    const stories = group?.stories ?? [];

    const [index, setIndex] = useState(0);

    const [mediaUrl, setMediaUrl] = useState(null);

    const [loadingMedia, setLoadingMedia] =
        useState(false);

    const [showViewers, setShowViewers] =
        useState(false);

    const [progress, setProgress] = useState(0);

    const [paused, setPaused] = useState(false);

    const [confirmDelete, setConfirmDelete] =
        useState(false);

    const videoRef = useRef(null);

    const viewedRef = useRef(new Set());

    const story =
        stories[Math.min(index, stories.length - 1)];

    const isMine = story?.user_id === user?.id;

    // ======================================================
    // Load + decrypt current story's media
    // ======================================================

    useEffect(() => {

        if (!story || !user) return;

        let cancelled = false;

        setLoadingMedia(true);

        setMediaUrl(null);

        setProgress(0);

        setShowViewers(false);

        storyService
            .getMedia(story, user.id)
            .then(blob => {

                if (cancelled) return;

                setMediaUrl(
                    URL.createObjectURL(blob)
                );

            })
            .catch(error => {

                console.error(
                    "[STORY-MEDIA]",
                    error
                );

                if (!cancelled) {

                    setMediaUrl(null);

                }

            })
            .finally(() => {

                if (!cancelled) {

                    setLoadingMedia(false);

                }

            });

        // Mark as viewed exactly once per story (only for
        // other people's stories — the backend ignores mine).
        if (
            !isMine &&
            !viewedRef.current.has(story.id)
        ) {

            viewedRef.current.add(story.id);

            void markStoryViewed(story.id);

        }

        return () => {

            cancelled = true;

        };

    }, [story?.id, user?.id]);

    // ======================================================
    // Auto-advance (5s per story, paused while a video
    // plays or the user is reading the viewer list)
    // ======================================================

    useEffect(() => {

        if (
            !story ||
            paused ||
            showViewers ||
            loadingMedia
        ) {
            return;
        }

        const startedAt = Date.now();

        const timer = setInterval(() => {

            const elapsed = Date.now() - startedAt;

            setProgress(
                Math.min(
                    100,
                    (elapsed / STORY_DURATION_MS) * 100
                )
            );

            if (elapsed >= STORY_DURATION_MS) {

                clearInterval(timer);

                setProgress(0);

                goNext();

            }

        }, 100);

        return () => clearInterval(timer);

    }, [
        story?.id,
        paused,
        showViewers,
        loadingMedia,
        index,
    ]);

    // ======================================================
    // Navigation
    // ======================================================

    function goNext() {

        setIndex(previous => {

            if (previous >= stories.length - 1) {

                onClose();

                return previous;

            }

            return previous + 1;

        });

    }

    function goPrevious() {

        setIndex(previous =>
            Math.max(0, previous - 1)
        );

    }

    const handleKeyDown =
        useCallback((event) => {

            if (event.key === "Escape") {

                onClose();

            }
            else if (event.key === "ArrowRight") {

                goNext();

            }
            else if (event.key === "ArrowLeft") {

                goPrevious();

            }

        }, [index, stories.length]);

    useEffect(() => {

        window.addEventListener(
            "keydown",
            handleKeyDown
        );

        return () =>
            window.removeEventListener(
                "keydown",
                handleKeyDown
            );

    }, [handleKeyDown]);

    useEffect(() => () => {
        if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    }, [mediaUrl]);

    // ======================================================
    // Delete (own stories only)
    // ======================================================

    async function handleDelete() {

        try {

            await deleteStory(story.id);

            const remaining =
                stories.filter(s => s.id !== story.id);

            if (remaining.length === 0) {

                onClose();

                return;

            }

            onGroupUpdated?.({
                ...group,
                stories: remaining,
            });

            setIndex(previous =>
                Math.min(
                    previous,
                    remaining.length - 1
                )
            );

            setConfirmDelete(false);

        }
        catch (error) {

            console.error(
                "[STORY-DELETE]",
                error
            );

        }

    }

    if (!story) return null;

    const handleVideoPlay = () => setPaused(true);

    const handleVideoPause = () => setPaused(false);

    return (
        <div className="story-viewer">
            <div className="story-viewer-backdrop" />

            <div className="story-viewer-card">
                {/* Progress bars */}
                <div className="story-progress-row">
                    {stories.map((item, i) => (
                        <div
                            key={item.id}
                            className={
                                i < index
                                    ? "story-progress done"
                                    : i === index
                                        ? "story-progress active"
                                        : "story-progress"
                            }
                        >
                            {i === index && (
                                <div
                                    className="story-progress-fill"
                                    style={{
                                        width: `${progress}%`,
                                    }}
                                />
                            )}
                        </div>
                    ))}
                </div>

                {/* Header */}
                <div className="story-viewer-header">
                    <span className="story-viewer-avatar">
                        <UserAvatar
                            user={group?.owner}
                            className="story-viewer-user-avatar"
                        />
                    </span>
                    <span className="story-viewer-name">
                        {group?.owner?.display_name}
                    </span>
                    <span className="story-viewer-time">
                        {formatTime(story.created_at)}
                    </span>

                    <span className="story-viewer-actions">
                        {isMine && (
                            <>
                                <button
                                    type="button"
                                    className={
                                        showViewers
                                            ? "story-btn active"
                                            : "story-btn"
                                    }
                                    onClick={() =>
                                        setShowViewers(v => !v)
                                    }
                                    title="Viewers"
                                >
                                    <svg
                                        width="20"
                                        height="20"
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
                                </button>

                                {!confirmDelete ? (
                                    <button
                                        type="button"
                                        className="story-btn danger"
                                        onClick={() =>
                                            setConfirmDelete(true)
                                        }
                                        title="Delete story"
                                    >
                                        <svg
                                            width="20"
                                            height="20"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M3 6h18" />
                                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                        </svg>
                                    </button>
                                ) : (
                                    <span className="story-delete-confirm">
                                        <button
                                            type="button"
                                            onClick={handleDelete}
                                        >
                                            Delete
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setConfirmDelete(false)
                                            }
                                        >
                                            Cancel
                                        </button>
                                    </span>
                                )}
                            </>
                        )}

                        <button
                            type="button"
                            className="story-btn"
                            onClick={onClose}
                            title="Close"
                        >
                            <svg
                                width="22"
                                height="22"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M18 6 6 18" />
                                <path d="m6 6 12 12" />
                            </svg>
                        </button>
                    </span>
                </div>

                {/* Media */}
                <div
                    className="story-viewer-media"
                    onClick={(event) => {

                        if (event.target.closest(".story-btn")) return;

                        const rect =
                            event.currentTarget.getBoundingClientRect();

                        if (event.clientX < rect.left + rect.width / 2) {

                            goPrevious();

                        }
                        else {

                            goNext();

                        }

                    }}
                >
                    {loadingMedia && (
                        <div className="story-viewer-loading">
                            <span className="story-spinner" />
                            <p>Decrypting…</p>
                        </div>
                    )}

                    {!loadingMedia && mediaUrl && (
                        story.media_type === "video"
                            ? (
                                <video
                                    ref={videoRef}
                                    src={mediaUrl}
                                    autoPlay
                                    loop
                                    playsInline
                                    onPlay={handleVideoPlay}
                                    onPause={handleVideoPause}
                                    onEnded={goNext}
                                />
                            )
                            : (
                                <img
                                    src={mediaUrl}
                                    alt={story.caption || ""}
                                />
                            )
                    )}

                    {!loadingMedia && !mediaUrl && (
                        <div className="story-viewer-loading">
                            <p>Could not decrypt this story.</p>
                        </div>
                    )}
                </div>

                {/* Caption */}
                {story.caption && !showViewers && (
                    <div
                        className={`story-viewer-caption${
                            !isMine
                                ? " story-viewer-caption--with-reactions"
                                : ""
                        }`}
                    >
                        {story.caption}
                    </div>
                )}

                {/* Story Reactions */}
                {!isMine && !showViewers && (
                    <StoryReactionBar storyId={story.id} />
                )}

                {isMine && showViewers && (
                    <div className="story-viewers-panel">
                        {(story.reactions?.summary ?? []).length > 0 && (
                            <div className="story-reactions-section">
                                <h4>Reactions</h4>
                                <div className="story-reactions-chips">
                                    {story.reactions.summary.map(group => (
                                        <span
                                            key={group.emoji}
                                            className="story-reaction-chip"
                                        >
                                            <span className="story-reaction-chip-emoji">
                                                {group.emoji}
                                            </span>
                                            <span className="story-reaction-chip-count">
                                                {group.count}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                                {(story.reactions.reactions ?? []).map(reactor => (
                                    <div
                                        key={reactor.user_id}
                                        className="story-viewer-row"
                                    >
                                        <span className="story-viewer-row-avatar">
                                            <UserAvatar
                                                user={{
                                                    id: reactor.user_id,
                                                    display_name:
                                                        reactor.display_name,
                                                    avatar_url:
                                                        reactor.avatar_url,
                                                }}
                                                className="story-viewer-user-avatar"
                                            />
                                        </span>
                                        <span className="story-viewer-row-name">
                                            {reactor.display_name}
                                        </span>
                                        <span className="story-viewer-row-time">
                                            {reactor.emoji} ·{" "}
                                            {formatTime(reactor.reacted_at)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <h4>
                            Viewed by {story.view_count ?? 0}
                        </h4>
                        {(story.viewers ?? []).length === 0 ? (
                            <p className="story-viewers-empty">
                                No one has viewed this story yet.
                            </p>
                        ) : (
                            (story.viewers ?? []).map(viewer => (
                                <div
                                    key={viewer.user_id}
                                    className="story-viewer-row"
                                >
                                    <span className="story-viewer-row-avatar">
                                        <UserAvatar
                                            user={{
                                                id: viewer.user_id,
                                                display_name:
                                                    viewer.display_name,
                                                avatar_url:
                                                    viewer.avatar_url,
                                            }}
                                            className="story-viewer-user-avatar"
                                        />
                                    </span>
                                    <span className="story-viewer-row-name">
                                        {viewer.display_name}
                                    </span>
                                    <span className="story-viewer-row-time">
                                        {formatTime(viewer.viewed_at)}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );

}

// ==========================================================
// Story Reaction Bar
// ==========================================================

const STORY_REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👏"];

function StoryReactionBar({ storyId }) {
    const [myReaction, setMyReaction] = useState(null);
    const [sending, setSending] = useState(false);

    async function handleReact(emoji) {
        if (sending) return;
        setSending(true);
        try {
            const res = await storyService.reactToStory(storyId, emoji);
            if (res.action === "removed") {
                setMyReaction(null);
            } else {
                setMyReaction(emoji);
            }
        } catch {
            // silent
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="story-reaction-bar">
            {STORY_REACTIONS.map((emoji) => (
                <button
                    key={emoji}
                    className={`story-reaction-btn ${
                        myReaction === emoji ? "active" : ""
                    }`}
                    onClick={() => handleReact(emoji)}
                    disabled={sending}
                    title={emoji}
                >
                    {emoji}
                </button>
            ))}
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