/* Nexara service worker — Web Push notifications.

 * Notifications never contain message content: message payloads
 * are end-to-end encrypted and the push payload only carries
 * metadata (sender name, conversation type). The real content is
 * decrypted inside the app, never in the worker.
 */

const APP_ORIGIN = self.location.origin;
const ICON = "/favicon.svg";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ----------------------------------------------------------
// Show a notification unless the app is visible and focused
// (the in-app UI already shows the message there).
// ----------------------------------------------------------
async function hasFocusedClient() {
  const clientsList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  return clientsList.some(
    (client) => client.focused && client.visibilityState === "visible"
  );
}

function titleFor(payload) {
  if (payload.event === "call_offer") {
    const kind = payload.call_type === "video" ? "video call" : "voice call";
    return `${payload.sender_name || "Someone"} is calling you… (${kind})`;
  }
  if (payload.event === "story") {
    return `${payload.sender_name || "A friend"} posted a status`;
  }
  if (payload.conversation_type === "group") {
    return `${payload.sender_name || "Someone"} sent a new group message`;
  }
  return `New message from ${payload.sender_name || "someone"}`;
}

function notificationTitle(payload) {
  if (payload.event === "call_offer") {
    return payload.call_type === "video"
      ? "Incoming video call"
      : "Incoming voice call";
  }
  if (payload.event === "story") {
    return "Status update";
  }
  return "Nexara";
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {};
  }

  event.waitUntil(
    (async () => {
      if (await hasFocusedClient()) {
        // The open app already shows this — no OS notification.
        return;
      }

      const options = {
        body: titleFor(payload),
        icon: ICON,
        badge: ICON,
        data: {
          url: "/",
          conversation_id: payload.conversation_id || null,
          sender_name: payload.sender_name || "",
          event: payload.event || "message",
        },
        tag: "nexara-" + (payload.conversation_id || "general"),
        renotify: true,
        silent: false,
      };

      await self.registration.showNotification(
        notificationTitle(payload),
        options
      );
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if (targetUrl) {
            try {
              await client.navigate(targetUrl);
            } catch (e) {
              /* same-origin navigation is allowed */
            }
          }
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })()
  );
});