import api from "../api/api";
import { logger } from '../utils/logger.js';

// ==========================================================
// Web Push (browser notifications) — WhatsApp-style
//
// Subscribes the current browser to the user's push channel.
// Payloads are redacted by design: message content is end-to-end
// encrypted, so notifications only carry sender + conversation
// metadata and the service worker shows a generic title.
// ==========================================================

const SW_PATH = "/sw.js";

const PUSH_ENABLED_KEY = "nexara_push_enabled";

function isSupported() {

    return (
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
    );

}

function base64UrlToUint8Array(base64url) {

    const padding =
        "=".repeat((4 - (base64url.length % 4)) % 4);

    const base64 =
        (base64url + padding)
            .replace(/-/g, "+")
            .replace(/_/g, "/");

    const raw = atob(base64);

    const bytes = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i += 1) {

        bytes[i] = raw.charCodeAt(i);

    }

    return bytes;

}

async function getVapidPublicKey() {

    const response =
        await api.get("/push/vapid-public-key");

    return response.data.public_key;

}

async function getRegistration() {

    return navigator.serviceWorker.register(SW_PATH);

}

export async function registerServiceWorker() {

    if (!isSupported()) return null;

    return getRegistration();

}

// ======================================================
// Subscribe this browser to push notifications
// ======================================================

export async function subscribe() {

    if (!isSupported()) return false;

    try {

        const registration =
            await getRegistration();

        const existing =
            await registration.pushManager.getSubscription();

        if (!existing) {

            const applicationServerKey =
                base64UrlToUint8Array(
                    await getVapidPublicKey()
                );

            await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey,
            });

        }

        const subscription =
            await registration.pushManager.getSubscription();

        if (!subscription) return false;

        const json = subscription.toJSON();

        await api.post("/push/subscribe", {
            endpoint: json.endpoint,
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
        });

        localStorage.setItem(PUSH_ENABLED_KEY, "1");

        return true;

    }
    catch (error) {

        logger.debug(
            "Push subscription skipped:",
            error?.message ?? error
        );

        return false;

    }

}

// ======================================================
// Unsubscribe this browser (logout / toggle off)
// ======================================================

export async function unsubscribe() {

    if (!isSupported()) return;

    try {

        const registration =
            await navigator.serviceWorker.getRegistration();

        const subscription =
            registration
                ? await registration.pushManager.getSubscription()
                : null;

        if (subscription) {

            // Remove from the backend first (match by endpoint),
            // then unsubscribe locally.
            try {

                const { data: subscriptions } =
                    await api.get("/push/subscriptions");

                for (const item of subscriptions) {

                    if (item.endpoint === subscription.endpoint) {

                        await api.delete(
                            `/push/subscriptions/${item.id}`
                        );

                    }

                }

            }
            catch (error) {

                logger.debug(
                    "Push backend cleanup failed:",
                    error?.message ?? error
                );

            }

            await subscription.unsubscribe();

        }

    }
    catch (error) {

        logger.debug(
            "Push unsubscription failed:",
            error?.message ?? error
        );

    }
    finally {

        localStorage.removeItem(PUSH_ENABLED_KEY);

    }

}

// ======================================================
// Current state
// ======================================================

export async function getPushState() {

    if (!isSupported()) return "unsupported";

    const enabled =
        localStorage.getItem(PUSH_ENABLED_KEY) === "1";

    if (!enabled) return "disabled";

    const permission = Notification.permission;

    if (permission === "denied") return "blocked";

    const registration =
        await navigator.serviceWorker.getRegistration();

    const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;

    return subscription ? "enabled" : "disabled";

}

export { isSupported };