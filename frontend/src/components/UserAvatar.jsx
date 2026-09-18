import { useEffect, useState } from "react";

import api from "../api/api";

import { avatarGradient, initials } from "../utils/avatar";

// ==========================================================
// Authenticated avatar fetch with in-page caching.
//
// Avatars are served by GET /users/{id}/avatar, which requires
// a Bearer token (impossible on a plain <img> tag), so we fetch
// them as blobs and display them via object URLs.
// ==========================================================

const avatarCache = new Map();

function loadAvatar(cacheKey, requestUrl) {
    const cached = avatarCache.get(cacheKey);

    if (cached?.promise) return cached.promise;

    const promise = (async () => {
        try {
            const response = await api.get(
                requestUrl,
                { responseType: "blob" }
            );

            const url = URL.createObjectURL(response.data);

            const existing = avatarCache.get(cacheKey);

            if (existing?.url) {
                URL.revokeObjectURL(existing.url);
            }

            avatarCache.set(cacheKey, { url });

            return url;
        }
        catch (error) {
            avatarCache.set(cacheKey, { url: null });

            return null;
        }
    })();

    avatarCache.set(cacheKey, { promise });

    return promise;
}

export function bustAvatarCache(userId) {
    const cached = avatarCache.get(userId);

    if (cached?.url) {
        URL.revokeObjectURL(cached.url);
    }

    avatarCache.delete(userId);

    window.dispatchEvent(
        new CustomEvent("avatar-updated", { detail: userId })
    );
}

export default function UserAvatar({
    user,
    className = "",
    children,
    endpoint,
}) {

    const [url, setUrl] = useState(null);

    const [tick, setTick] = useState(0);

    const userId = user?.id;

    // Group avatars live at /conversations/{id}/avatar;
    // namespace their cache entries so they can never
    // collide with user ids.
    const cacheKey = endpoint
        ? `group:${userId}`
        : userId;

    const hasAvatar = !!user?.avatar_url;

    useEffect(() => {

        if (!userId || !hasAvatar) {
            setUrl(null);
            return;
        }

        let active = true;

        const cached = avatarCache.get(cacheKey);

        if (cached?.url !== undefined) {
            setUrl(cached.url);
            return;
        }

        loadAvatar(
            cacheKey,
            endpoint ?? `/users/${userId}/avatar`
        ).then((loadedUrl) => {
            if (active) setUrl(loadedUrl);
        });

        return () => { active = false; };

    }, [userId, hasAvatar, tick, cacheKey, endpoint]);

    useEffect(() => {

        const handler = (event) => {
            if (event.detail === userId) {
                setUrl(null);
                setTick((value) => value + 1);
            }
        };

        window.addEventListener("avatar-updated", handler);

        return () => {
            window.removeEventListener("avatar-updated", handler);
        };

    }, [userId]);

    if (!user) return null;

    if (hasAvatar && url) {
        return (
            <div className={className}>
                <img
                    className="avatar-img"
                    src={url}
                    alt=""
                    draggable={false}
                />
                {children}
            </div>
        );
    }

    return (
        <div
            className={className}
            style={{
                background: avatarGradient(
                    user.display_name ?? user.username ?? user.email
                ),
            }}
        >
            {initials(
                user.display_name ?? "?"
            )}
            {children}
        </div>
    );
}
