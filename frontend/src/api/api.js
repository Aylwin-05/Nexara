import axios from "axios";

import { logger } from "../utils/logger.js";

// Absolute server origin when running outside a normal browser
// origin (Capacitor/WebView builds). Empty in the web app, which
// keeps every URL relative exactly as before.
//
// The build-time VITE_API_URL is the single source of truth. The
// native (Capacitor) shell bakes its target at compile time via
// Mobile/dev-build.ps1 or Mobile/prod-build.ps1, so the WebView
// always talks to the intended backend — never to its own
// https://localhost asset server, and never to a stale runtime
// override. There is intentionally NO runtime override: the server
// address is fixed at build time and must not be mutable in-app.
export function getConfiguredServer() {

    return (
        import.meta.env.VITE_API_URL ||
        ""
    );

}

const SERVER_URL = getConfiguredServer();

const api = axios.create({
    baseURL: `${SERVER_URL}/api/v1`,
    headers: {
        "Content-Type": "application/json",
    },
    timeout: 30000,
    // Required for the refresh-token cookie when the API lives
    // on another origin (native shells); harmless same-origin.
    withCredentials: true,
});

// ==========================================================
// ACCESS TOKEN STORE
//
// The access token lives exclusively in memory.  On page reload
// the module-level variable resets to null; AuthContext performs
// a silent refresh using the HttpOnly refresh-token cookie to
// rehydrate without exposing the bearer token to JavaScript
// storage (XSS protection).
// ==========================================================

let accessToken = null;

export function setAccessToken(token) {
    accessToken = token;
}

export function getAccessToken() {

    return accessToken;

}

export function clearAccessToken() {

    setAccessToken(null);

}

// ==========================================================
// REFRESH ACCESS TOKEN (single-flight)
//
// The refresh token lives in an HttpOnly cookie which the
// browser attaches automatically. Only one refresh runs at a
// time: concurrent callers (e.g. the React StrictMode double
// mount in dev) share the in-flight request instead of rotating
// the token twice and tripping the server's reuse detection,
// which would revoke the entire family.
// ==========================================================

let refreshPromise = null;

export async function refreshAccessToken() {

    if (refreshPromise) {

        return refreshPromise;

    }

    refreshPromise = (async () => {

        const response =
            await axios.post(
                `${SERVER_URL}/api/v1/auth/refresh`,
                null,
                { withCredentials: true }
            );

        const newAccessToken =
            response.data.access_token;

        if (!newAccessToken) {

            throw new Error(
                "Refresh returned no access token."
            );

        }

        setAccessToken(newAccessToken);

        return newAccessToken;

    })();

    try {

        return await refreshPromise;

    }

    finally {

        refreshPromise = null;

    }

}

// ==========================================================
// SESSION-EXPIRED EVENT
//
// Fired when a refresh attempt fails and the session is truly
// dead. AuthContext listens and drops its local state so the
// route guards send the user to the login screen without a hard
// page reload (window.location) that nukes the SPA state.
// ==========================================================

export function notifySessionExpired() {

    window.dispatchEvent(
        new Event("nexara:auth-expired")
    );

}

// ==========================================================
// EXPIRY CHECK
//
// JWT payloads carry an exp claim. When the access token is
// expired (or expiring within 30s), the request interceptor
// refreshes BEFORE the request goes out, so reloading the page
// on a stale-but-refreshable session never produces the loud
// 401 → refresh → retry dance in the console.
// ==========================================================

export function isAccessTokenExpired() {

    const token =
        getAccessToken();

    if (!token) {

        return false;

    }

    try {

        const b64 =
            token
                .split(".")[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/");

        const payload =
            JSON.parse(
                atob(
                    b64.padEnd(
                        Math.ceil(b64.length / 4) * 4,
                        "="
                    )
                )
            );

        if (!payload?.exp) {

            return false;

        }

        return (
            payload.exp * 1000 <=
            Date.now() + 30000
        );

    }

    catch {

        // Malformed token: let the request go and let the
        // response interceptor surface the 401.
        return false;

    }

}

// ==========================================================
// REQUEST INTERCEPTOR
// ==========================================================

api.interceptors.request.use(

    async (config) => {

        if (isAccessTokenExpired()) {

            try {

                await refreshAccessToken();

            }

            catch {
                // Session unrecoverable — fall through and let
                // the request 401 so the response interceptor
                // cleans the session up.
            }

        }

        const token =
            getAccessToken();

        if (token) {

            config.headers.Authorization =
                `Bearer ${token}`;

        }

        return config;

    },

    (error) => Promise.reject(error)

);

// ==========================================================
// RESPONSE INTERCEPTOR
// ==========================================================

api.interceptors.response.use(

    (response) => response,

    async (error) => {

        const originalRequest =
            error.config;

        //------------------------------------------------------
        // Access token expired / rejected
        //------------------------------------------------------

        if (

            error.response?.status === 401 &&

            !originalRequest._retry

        ) {

            originalRequest._retry = true;

            try {

                const newAccessToken =
                    await refreshAccessToken();

                originalRequest.headers.Authorization =
                    `Bearer ${newAccessToken}`;

                return api(
                    originalRequest
                );

            }

            catch (refreshError) {

                clearAccessToken();

                localStorage.removeItem(
                    "user"
                );

                notifySessionExpired();

                return Promise.reject(
                    refreshError
                );

            }

        }

        if (error.response?.status !== 404) {
            logger.error(
                "API Error:",
                error.response?.data ||
                error.message
            );
        }

        //------------------------------------------------------
        // Idempotent network retry. No response at all = the
        // request may or may not have landed. A retry is only
        // safe with a client_message_id so the server replays
        // the original instead of duplicating it.
        //------------------------------------------------------

        if (
            !error.response &&
            originalRequest?.method?.toLowerCase() === "post" &&
            originalRequest?.data?.client_message_id &&
            !originalRequest._retry
        ) {

            originalRequest._retry = true;

            return api(originalRequest);

        }

        return Promise.reject(error);

    }

);

export default api;