import { useRef, useState } from "react";

import "./StoryComposer.css";

import { useAuth } from "../../context/AuthContext";
import { useChatSocket } from "../../context/ChatSocketContext";
import { getApiErrorDetail } from "../../utils/errors";

const ACCEPTED =
    "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";

// ==========================================================
// StoryComposer — post a new 24h status
//
// Pick an image/video, add an optional caption, and post.
// Encryption happens client-side (storyService.upload):
// the server never sees the plaintext or the file key.
// ==========================================================

export default function StoryComposer({ onClose, onPosted }) {

    const { user } = useAuth();

    const {
        postStory,
    } = useChatSocket();

    const [file, setFile] = useState(null);

    const [previewUrl, setPreviewUrl] =
        useState(null);

    const [caption, setCaption] = useState("");

    const [posting, setPosting] = useState(false);

    const [error, setError] = useState(null);

    const inputRef = useRef(null);

    function handlePick(event) {

        const picked = event.target.files?.[0];

        if (!picked) return;

        if (picked.size > 20 * 1024 * 1024) {

            setError("Status media is limited to 20 MB.");

            return;

        }

        if (previewUrl) {

            URL.revokeObjectURL(previewUrl);

        }

        setFile(picked);

        setPreviewUrl(URL.createObjectURL(picked));

        setError(null);

    }

    async function handlePost() {

        if (!file || posting) return;

        setPosting(true);

        setError(null);

        try {

            const story = await postStory({
                file,
                caption: caption.trim(),
            });

            onPosted?.(story);

        }
        catch (caught) {

            console.error(
                "[STORY-POST]",
                caught
            );

            setError(getApiErrorDetail(caught, "Could not post your status. Try again."));

            setPosting(false);

        }

    }

    const isVideo = file?.type?.startsWith("video/");

    return (
        <div className="story-composer-backdrop">
            <div className="story-composer">
                <div className="story-composer-header">
                    <h3>New status</h3>
                    <button
                        type="button"
                        className="story-composer-close"
                        onClick={onClose}
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
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                        </svg>
                    </button>
                </div>

                <div className="story-composer-body">
                    {!previewUrl ? (
                        <button
                            type="button"
                            className="story-composer-pick"
                            onClick={() =>
                                inputRef.current?.click()
                            }
                        >
                            <span className="story-composer-pick-icon">
                                <svg
                                    width="36"
                                    height="36"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <rect x="3" y="3" width="18" height="18" rx="2" />
                                    <circle cx="8.5" cy="8.5" r="1.5" />
                                    <path d="m21 15-5-5L5 21" />
                                </svg>
                            </span>
                            <p>
                                Choose a photo or video
                            </p>
                            <small>
                                Up to 20 MB · JPEG, PNG, WebP,
                                GIF, MP4, WebM
                            </small>
                        </button>
                    ) : (
                        <div className="story-composer-preview">
                            {isVideo
                                ? (
                                    <video
                                        src={previewUrl}
                                        autoPlay
                                        loop
                                        muted
                                        playsInline
                                    />
                                )
                                : (
                                    <img
                                        src={previewUrl}
                                        alt="Status preview"
                                    />
                                )
                            }
                            <button
                                type="button"
                                className="story-composer-repick"
                                onClick={() =>
                                    inputRef.current?.click()
                                }
                                title="Choose another file"
                            >
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
                                    <path d="M21 3v6h-6" />
                                </svg>
                            </button>
                        </div>
                    )}

                    <textarea
                        className="story-composer-caption"
                        placeholder="Add a caption…"
                        value={caption}
                        maxLength={500}
                        onChange={(event) =>
                            setCaption(event.target.value)
                        }
                        rows={2}
                    />
                </div>

                {error && (
                    <p className="story-composer-error">
                        {error}
                    </p>
                )}

                <div className="story-composer-footer">
                    <button
                        type="button"
                        className="story-composer-cancel"
                        onClick={onClose}
                        disabled={posting}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="story-composer-post"
                        onClick={handlePost}
                        disabled={!file || posting}
                    >
                        {posting ? "Posting…" : "Post"}
                    </button>
                </div>

                <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPTED}
                    onChange={handlePick}
                    hidden
                />
            </div>
        </div>
    );

}