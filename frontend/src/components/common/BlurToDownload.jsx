import { useState } from "react";
import toast from "react-hot-toast";

import "./BlurToDownload.css";

export default function BlurToDownload({
    attachment,
    previewUrl,
    onDecrypt,
}) {
    const [blurred, setBlurred] = useState(true);
    const [decrypting, setDecrypting] = useState(false);
    const [decryptedUrl, setDecryptedUrl] = useState(null);

    const handleClick = async () => {
        if (!blurred) return;

        setDecrypting(true);
        try {
            const url = await onDecrypt(attachment);
            setDecryptedUrl(url);
            setBlurred(false);
        } catch (err) {
            toast.error("Failed to decrypt attachment.");
        } finally {
            setDecrypting(false);
        }
    };

    const handleDownload = (e) => {
        e.stopPropagation();
        if (!decryptedUrl) return;

        const a = document.createElement("a");
        a.href = decryptedUrl;
        a.download = attachment.original_name || "attachment";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const src = decryptedUrl || previewUrl;

    return (
        <div
            className={`blur-to-download ${blurred ? "blurred" : ""}`}
            onClick={handleClick}
        >
            {src && (
                <img
                    src={src}
                    alt={attachment.original_name || "Attachment"}
                    className="blur-to-download__img"
                    draggable={false}
                />
            )}

            {blurred && (
                <div className="blur-to-download__overlay">
                    {decrypting ? (
                        <div className="blur-to-download__spinner" />
                    ) : (
                        <svg
                            className="blur-to-download__icon"
                            width="32"
                            height="32"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                    )}
                    <span className="blur-to-download__label">
                        Tap to view & download
                    </span>
                </div>
            )}

            {!blurred && (
                <button
                    className="blur-to-download__download-btn"
                    onClick={handleDownload}
                    title="Download"
                >
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </button>
            )}
        </div>
    );
}
