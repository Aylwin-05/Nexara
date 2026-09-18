import { useEffect } from "react";

export default function ImageLightbox({
    attachment,
    url,
    viewOnce = false,
    onClose,
}) {

    useEffect(() => {

        function handleKeyDown(event) {

            if (event.key === "Escape") {

                onClose();

            }

        }

        window.addEventListener(
            "keydown",
            handleKeyDown,
        );

        return () =>
            window.removeEventListener(
                "keydown",
                handleKeyDown,
            );

    }, [onClose]);

    if (!attachment || !url) return null;

    return (

        <div
            className="lightbox-overlay"
            onClick={onClose}
        >

            <div
                className="lightbox-bar"
                onClick={event =>
                    event.stopPropagation()
                }
            >

                <span className="lightbox-name">

                    {viewOnce
                        ? "View once"
                        : (attachment.original_name || "Image")}

                </span>

                <div className="lightbox-actions">

                    {!viewOnce && (

                        <a
                            className="lightbox-download"
                            href={url}
                            download={attachment.original_name || "image"}
                        >

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
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <path d="m7 10 5 5 5-5" />
                                <path d="M12 15V3" />
                            </svg>

                            Download

                        </a>

                    )}

                    <button
                        type="button"
                        className="lightbox-close"
                        onClick={onClose}
                        aria-label="Close"
                    >

                        <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>

                    </button>

                </div>

            </div>

            {attachment.attachment_type === "video" ? (

                <video
                    className="lightbox-image"
                    src={url}
                    controls
                    autoPlay
                    controlsList={
                        viewOnce ? "nodownload noplaybackrate" : undefined
                    }
                    disablePictureInPicture={viewOnce || undefined}
                    onContextMenu={
                        viewOnce
                            ? event => event.preventDefault()
                            : undefined
                    }
                    onClick={event =>
                        event.stopPropagation()
                    }
                />

            ) : (

                <img
                    className="lightbox-image"
                    src={url}
                    alt={attachment.original_name || "Image"}
                    draggable={!viewOnce}
                    onContextMenu={
                        viewOnce
                            ? event => event.preventDefault()
                            : undefined
                    }
                    onClick={event =>
                        event.stopPropagation()
                    }
                />

            )}

        </div>

    );

}