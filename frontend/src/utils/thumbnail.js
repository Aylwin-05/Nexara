// ==========================================================
// Client-side thumbnail generation for E2EE attachments
//
// Thumbnails are generated BEFORE encryption so the server
// never sees plaintext. The thumbnail is a small, low-quality
// JPEG blob that travels alongside the encrypted file.
// ==========================================================

const THUMB_MAX_WIDTH = 200;
const THUMB_MAX_HEIGHT = 200;
const THUMB_QUALITY = 0.6;

/**
 * Generate a thumbnail from an image File/Blob.
 * Returns a File object ready for upload, or null on failure.
 */
export async function generateImageThumbnail(file) {
    try {
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement("canvas");
        const { width, height } = fitDimensions(
            bitmap.width,
            bitmap.height,
            THUMB_MAX_WIDTH,
            THUMB_MAX_HEIGHT,
        );
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        return new Promise((resolve) => {
            canvas.toBlob(
                (blob) => {
                    if (!blob) return resolve(null);
                    resolve(
                        new File([blob], "thumb.jpg", {
                            type: "image/jpeg",
                        })
                    );
                },
                "image/jpeg",
                THUMB_QUALITY,
            );
        });
    } catch {
        return null;
    }
}

/**
 * Generate a thumbnail from a video File.
 * Seeks to 1s and captures a frame.
 */
export async function generateVideoThumbnail(file) {
    try {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.src = url;

        await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = reject;
            video.currentTime = 1;
        });

        const canvas = document.createElement("canvas");
        const { width, height } = fitDimensions(
            video.videoWidth,
            video.videoHeight,
            THUMB_MAX_WIDTH,
            THUMB_MAX_HEIGHT,
        );
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, width, height);
        URL.revokeObjectURL(url);

        return new Promise((resolve) => {
            canvas.toBlob(
                (blob) => {
                    if (!blob) return resolve(null);
                    resolve(
                        new File([blob], "thumb.jpg", {
                            type: "image/jpeg",
                        })
                    );
                },
                "image/jpeg",
                THUMB_QUALITY,
            );
        });
    } catch {
        return null;
    }
}

/**
 * Extract video dimensions without generating a thumbnail.
 */
export async function getVideoDimensions(file) {
    try {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.preload = "metadata";
        video.src = url;
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = resolve;
            video.onerror = reject;
        });
        const dims = {
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
        };
        URL.revokeObjectURL(url);
        return dims;
    } catch {
        return null;
    }
}

/**
 * Extract image dimensions.
 */
export function getImageDimensions(file) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const dims = { width: img.width, height: img.height };
            URL.revokeObjectURL(img.src);
            resolve(dims);
        };
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(file);
    });
}

/**
 * Fit source dimensions within max bounds while preserving aspect ratio.
 */
function fitDimensions(srcW, srcH, maxW, maxH) {
    if (srcW <= maxW && srcH <= maxH) {
        return { width: srcW, height: srcH };
    }
    const ratio = Math.min(maxW / srcW, maxH / srcH);
    return {
        width: Math.round(srcW * ratio),
        height: Math.round(srcH * ratio),
    };
}
