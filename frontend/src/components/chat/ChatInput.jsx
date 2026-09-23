import {
    useEffect,
    useRef,
    useState,
} from "react";
import toast from "react-hot-toast";

import VoiceRecorder from "./VoiceRecorder";

import PresencePet from "../PresencePet";

import { useAuth } from "../../context/AuthContext";
import { animateSendPulse } from "../../utils/animations";
import { messageSnippet } from "../../utils/message";

import "./Chat.css";

function PaperclipIcon() {
    return (
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
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
    );
}

function SendIcon() {
    return (
        <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m22 2-7 20-4-9-9-4z" />
            <path d="M22 2 11 13" />
        </svg>
    );
}

// ==========================================================
// Emoji picker (self-contained, no external dependency)
// ==========================================================

const EMOJI_CATEGORIES = [
    {
        label: "Smileys",
        emojis: [
            "😀", "😄", "😁", "😆", "😅", "😂", "🤣", "😊",
            "😇", "🙂", "😉", "😍", "🥰", "😘", "😋", "😎",
            "🤩", "🥳", "😏", "😜", "🤪", "😢", "😭", "😤",
            "😠", "🤯", "😳", "🥺", "😱", "🤔", "🤫", "😴",
        ],
    },
    {
        label: "Gestures",
        emojis: [
            "👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "👌",
            "✌️", "🤞", "👋", "✋", "🤙", "👀", "🧠", "💯",
        ],
    },
    {
        label: "Hearts",
        emojis: [
            "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
            "💖", "💘", "💝", "💔", "🔥", "✨", "⭐", "🎉",
        ],
    },
    {
        label: "Animals",
        emojis: [
            "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
            "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
        ],
    },
    {
        label: "Food",
        emojis: [
            "🍎", "🍌", "🍉", "🍇", "🍓", "🍕", "🍔", "🍟",
            "🌮", "🍣", "🍩", "🍪", "🍰", "☕", "🍺", "🥤",
        ],
    },
    {
        label: "Activity",
        emojis: [
            "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🎱", "🏓",
            "🎮", "🎸", "🎹", "🎤", "🎬", "🎯", "🏆", "🚴",
        ],
    },
    {
        label: "Travel",
        emojis: [
            "🚗", "🚕", "🚌", "🚁", "✈️", "🚀", "⛵", "🚲",
            "🏖️", "🏔️", "🌋", "🏝️", "🌅", "🌈", "🌙", "☀️",
        ],
    },
    {
        label: "Symbols",
        emojis: [
            "✅", "❌", "❗", "❓", "💡", "📌", "🔔", "🔒",
            "🚫", "⚠️", "♻️", "💰", "📱", "💻", "📷", "🎁",
        ],
    },
];

function EmojiPicker({ onPick }) {
    return (
        <div className="emoji-picker">
            {EMOJI_CATEGORIES.map(category => (
                <div
                    key={category.label}
                    className="emoji-category"
                >
                    <span className="emoji-category-label">
                        {category.label}
                    </span>
                    <div className="emoji-grid">
                        {category.emojis.map(emoji => (
                            <button
                                key={emoji}
                                type="button"
                                className="emoji-btn"
                                aria-label={emoji}
                                onClick={() =>
                                    onPick(emoji)
                                }
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function ChatInput({
    onSend,
    typing,
    stopTyping,
    replyTo = null,
    onCancelReply,
    editTarget = null,
    onEdit,
    onCancelEdit,
    presenceStyle = null,
}) {

    const { user } = useAuth();

    const [text, setText] =
        useState("");

    const [selectedFile, setSelectedFile] =
        useState(null);

    const [viewOnce, setViewOnce] =
        useState(false);

    // Attachment upload progress: null while idle, otherwise
    // { progress: number|null (null = still encrypting), fileName }
    const [sending, setSending] = useState(null);

    const timeoutRef =
        useRef(null);

    const fileInputRef =
        useRef(null);

    const abortRef =
        useRef(null);

    const [emojiOpen, setEmojiOpen] =
        useState(false);

    const emojiRef =
        useRef(null);

    const sendBtnRef =
        useRef(null);

    // Close the emoji picker when clicking elsewhere
    useEffect(() => {

        if (!emojiOpen) return;

        function closeEmoji(event) {

            if (
                emojiRef.current &&
                !emojiRef.current.contains(event.target)
            ) {

                setEmojiOpen(false);

            }

        }

        document.addEventListener(
            "mousedown",
            closeEmoji,
        );

        return () =>
            document.removeEventListener(
                "mousedown",
                closeEmoji,
            );

    }, [emojiOpen]);

    // Prefill the input when entering edit mode
    useEffect(() => {

        if (editTarget) {

            setText(editTarget.content ?? "");

        }

    }, [editTarget?.id]);

    // ==========================================================
    // Typing
    // ==========================================================

    function handleChange(e) {

        const value =
            e.target.value;

        setText(value);

        typing();

        clearTimeout(
            timeoutRef.current
        );

        timeoutRef.current =
            setTimeout(() => {

                stopTyping();

            }, 1000);

    }

    // ==========================================================
    // File Picker
    // ==========================================================

    function handleFileSelect(e) {

        const file =
            e.target.files[0];

        if (!file) return;

        setSelectedFile(file);

        e.target.value = "";

    }

    // ==========================================================
    // Voice Recorder Callback
    // ==========================================================

    function handleVoiceRecorded(file) {

        setSelectedFile(file);

    }

    // ==========================================================
    // Emoji picker
    // ==========================================================

    function handleEmojiPick(emoji) {

        setText(current => current + emoji);

        setEmojiOpen(false);

        // Keep focus in the input so typing continues
        document
            .querySelector(".chat-input-field")
            ?.focus();

    }

    // ==========================================================
    // Send / Edit
    // ==========================================================

    function handleCancelUpload() {

        // Cancels at ANY point of the send: aborts an
        // in-flight upload, or interrupts the pre-relay hold
        // phase (sendMessage then throws ERR_CANCELED, cleans
        // up the backend message and never relays it).
        abortRef.current?.abort();

    }

    async function handleSend() {

        if (
            !text.trim() &&
            !selectedFile
        ) {
            return;
        }

        if (editTarget) {

            if (!text.trim()) return;

            await onEdit?.(
                editTarget.id,
                text.trim(),
            );

            setText("");

            return;

        }

        //------------------------------------------------------
        // Attachments: wire a progress callback + abort
        // controller into the upload so the user can watch it
        // and cancel mid-flight.
        //------------------------------------------------------

        // Keep the progress panel on screen for at least this
        // long so the user has time to react (fast uploads
        // would otherwise flash by in milliseconds).
        const MIN_PROGRESS_VISIBLE_MS = 5000;

        const startedAt =
            Date.now();

        const controller =
            new AbortController();

        abortRef.current = controller;

        if (selectedFile) {

            setSending({
                progress: 0,
                fileName: selectedFile.name,
            });

        }

        try {

            await onSend(
                text,
                selectedFile,
                {
                    onProgress: (progress) => {

                        setSending(current =>
                            current
                                ? {
                                    ...current,
                                    progress,
                                    done: progress === 100,
                                }
                                : current
                        );

                    },

                    signal: controller.signal,

                    viewOnce,

                    // The send flow holds the "Sent" panel for
                    // the rest of the minimum visibility window
                    // before the message actually relays.
                    holdUntil:
                        startedAt +
                        MIN_PROGRESS_VISIBLE_MS,
                },
            );

        }
        catch (error) {

            if (
                error?.code ===
                    "ERR_CANCELED"
            ) {

                toast(
                    "Upload cancelled",
                );

            }
            else {

                throw error;

            }

        }
        finally {

            abortRef.current = null;

            if (!editTarget && text.trim()) {
                animateSendPulse(sendBtnRef.current);
            }

            setText("");

            setSelectedFile(null);

            setViewOnce(false);

            stopTyping();

            setSending(null);

        }

    }

    // ==========================================================
    // Cleanup
    // ==========================================================

    useEffect(() => {

        return () => {

            clearTimeout(
                timeoutRef.current
            );

        };

    }, []);

    const replySenderName =
        replyTo?.sender_id === user?.id
            ? "You"
            : replyTo?.sender_display_name ||
                "Unknown";

    return (

        <div className="chat-input">

            {presenceStyle && (
                <span className="chat-peek composer-peek">
                    <PresencePet
                        style={presenceStyle}
                    />
                </span>
            )}

            <input

                ref={fileInputRef}

                type="file"

                style={{
                    display: "none",
                }}

                onChange={
                    handleFileSelect
                }

            />

            {/* REPLY QUOTE BAR */}

            {replyTo && !editTarget && (

                <div className="input-quote-bar">

                    <div className="input-quote-accent" />

                    <div className="input-quote-body">

                        <span className="input-quote-name">

                            {replySenderName}

                        </span>

                        <span className="input-quote-text">

                            {messageSnippet(replyTo)}

                        </span>

                    </div>

                    <button

                        type="button"

                        className="input-quote-cancel"

                        aria-label="Cancel reply"

                        onClick={onCancelReply}

                    >

                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>

                    </button>

                </div>

            )}

            {/* EDIT BAR */}

            {editTarget && (

                <div className="input-quote-bar editing">

                    <div className="input-quote-accent" />

                    <div className="input-quote-body">

                        <span className="input-quote-name">

                            Editing message

                        </span>

                    </div>

                    <button

                        type="button"

                        className="input-quote-cancel"

                        aria-label="Cancel editing"

                        onClick={onCancelEdit}

                    >

                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>

                    </button>

                </div>

            )}

            {selectedFile && !editTarget && (

                <div className="selected-file">

                    <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>

                    <span className="selected-file-name">

                        {selectedFile.name}

                    </span>

                    <button

                        type="button"

                        className={`view-once-toggle ${
                            viewOnce ? "active" : ""
                        }`}

                        title={viewOnce
                            ? "View once: on (media disappears after the recipient opens it)"
                            : "Send as view-once media"}

                        aria-label="Toggle view once"

                        onClick={() =>
                            setViewOnce(v => !v)
                        }

                    >

                        {viewOnce ? (
                            <svg
                                width="15"
                                height="15"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                                <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                        ) : (
                            <svg
                                width="15"
                                height="15"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        )}

                    </button>

                    <button

                        type="button"

                        className="selected-file-clear"

                        aria-label="Remove attachment"

                        onClick={() =>
                            setSelectedFile(null)
                        }

                    >

                        <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>

                    </button>

                </div>

            )}

            {/* UPLOAD PROGRESS BAR (with cancel) */}

            {sending && (

                <div className="upload-progress">

                    <svg
                        className="upload-progress-icon"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>

                    <div className="upload-progress-body">

                        <div className="upload-progress-top">

                            <span className="upload-progress-name">

                                {sending.done
                                    ? `Sent ${sending.fileName}`
                                    : `Sending ${sending.fileName}`}

                            </span>

                            <span className="upload-progress-pct">

                                {sending.done
                                    ? "100%"
                                    : sending.progress == null
                                        ? "…"
                                        : `${sending.progress}%`}

                            </span>

                        </div>

                        <div className="upload-progress-track">

                            <div
                                className={
                                    sending.done
                                        ? "upload-progress-fill done"
                                        : "upload-progress-fill"
                                }
                                style={{
                                    width: `${
                                        sending.done
                                            ? 100
                                            : (sending.progress ?? 0)
                                    }%`,
                                }}
                            />

                        </div>

                        <div className="upload-progress-sub">

                            {sending.done

                                ? "Sent"

                                : sending.progress == null

                                    ? "Encrypting & preparing…"

                                    : `${100 - sending.progress}% remaining`}

                        </div>

                    </div>

                    <button

                        type="button"

                        className="upload-cancel-btn"

                        aria-label="Cancel send"

                        title="Cancel send"

                        onClick={handleCancelUpload}

                    >

                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>

                    </button>

                </div>

            )}

            <div className="chat-input-bar">

                {/* Emoji Picker (with panel) */}

                {!editTarget && (

                    <div
                        ref={emojiRef}
                        className="emoji-wrap"
                    >

                        {emojiOpen && (

                            <EmojiPicker
                                onPick={handleEmojiPick}
                            />

                        )}

                        <button

                            type="button"

                            className={`icon-btn ${
                                emojiOpen ? "active" : ""
                            }`}

                            aria-label="Emoji"

                            onClick={() =>
                                setEmojiOpen(open => !open)
                            }

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
                                <circle cx="12" cy="12" r="10" />
                                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                                <line x1="9" y1="9" x2="9.01" y2="9" />
                                <line x1="15" y1="9" x2="15.01" y2="9" />
                            </svg>

                        </button>

                    </div>

                )}

                {/* Voice Recorder */}

                {!editTarget && (

                    <VoiceRecorder

                        onRecorded={
                            handleVoiceRecorded
                        }

                    />

                )}

                {/* File Picker */}

                {!editTarget && (

                    <button

                        type="button"

                        className="icon-btn"

                        aria-label="Attach file"

                        onClick={() =>
                            fileInputRef.current.click()
                        }

                    >

                        <PaperclipIcon />

                    </button>

                )}

                {/* Text */}

                <input

                    className="chat-input-field"

                    type="text"

                    value={text}

                    placeholder={editTarget
                        ? "Edit message..."
                        : "Type a message..."}

                    onChange={handleChange}

                    onKeyDown={(e) => {

                        if (
                            e.key === "Enter"
                        ) {

                            handleSend();

                        }

                    }}

                />

                {/* Send / Save */}

                <button

                    type="button"

                    ref={sendBtnRef}
                    className="send-btn"

                    aria-label={editTarget
                        ? "Save edited message"
                        : "Send message"}

                    disabled={
                        editTarget
                            ? !text.trim()
                            : (!text.trim() && !selectedFile) ||
                                Boolean(sending)
                    }

                    onClick={handleSend}

                >

                    <SendIcon />

                </button>

            </div>

        </div>

    );

}
