import { getAccessToken, getConfiguredServer, refreshAccessToken, isAccessTokenExpired } from "../api/api";
import { logger } from '../utils/logger.js';
import { enqueueMessage } from '../utils/offlineCache.js';

class WebSocketService {

    constructor() {

        this.socket = null;

        this.listeners = [];

        this.reconnectTimer = null;

        this.heartbeatTimer = null;

        this.shouldReconnect = false;

        this.reconnectAttempts = 0;

        this.lastAliveAt = null;

        this.token = null;

        // Reconnect policy: 1s, 2s, 4s ... capped at 30s
        this.maxReconnectDelay = 30_000;

        // Heartbeat every 20s; declare dead if silent for 60s
        this.heartbeatInterval = 20_000;

        this.staleThreshold = 60_000;

        // Offline message queue: messages that were attempted
        // while the socket was not OPEN are stored here and
        // replayed once the connection is re-established.
        this._pendingQueue = [];

        // Maximum number of queued messages before oldest are dropped
        this._pendingQueueMax = 100;

    }

    // ======================================================
    // STATUS
    // ======================================================

    isConnected() {
        return (
            this.socket != null &&
            this.socket.readyState === WebSocket.OPEN
        );
    }

    // ======================================================
    // CONNECT
    // ======================================================

    connect(
        token,
    ) {

        this.token = token;

        this.shouldReconnect = true;

        this.reconnectAttempts = 0;

        this._openSocket();

    }

    _openSocket() {

        this._closeSocket();

        this.shouldReconnect = true;

        // Same source of truth as api.js (getConfiguredServer):
        // "nexara.server_url" localStorage override first, then the
        // build-time VITE_API_URL. http(s) is upgraded to ws(s).
        // VITE_WS_URL is honoured too if it is set on its own.
        const server =
            getConfiguredServer() ||
            import.meta.env.VITE_WS_URL;

        const isNative = !!(
            typeof window !== "undefined" &&
            window.Capacitor?.isNativePlatform?.()
        );

        // No server is configured. In the web app the SPA and the API
        // share an origin, so fall back to window.location. In the
        // native Capacitor shell the WebView origin is the app's own
        // asset server (https://localhost) — connecting there would
        // silently web-socket to the wrong place and loop forever,
        // so refuse rather than misbehave.
        let url;

        if (server) {
            url = `${server.replace(/^http/, "ws")}/ws/me`;
        }
        else if (!isNative) {
            url = `${window.location.protocol === "https:"
                ? "wss"
                : "ws"
            }://${window.location.host}/ws/me`;
        }
        else {
            url = null;
        }

        if (!url) {
            this.socket = null;
            this.shouldReconnect = false;
            return;
        }

        const freshToken = getAccessToken() || this.token;

        // No usable token, or the one we hold is expired (access
        // tokens live 15 min; the HTTP layer refreshes them, but the
        // socket would otherwise keep offering the stale token and
        // have every reconnect rejected with 403). On a page reload
        // the token is in memory only and restored by the silent
        // refresh, so connecting now would offer the subprotocol
        // "nexara.null"/"nexara.undefined" — also a 403 loop.
        // Refresh once, then connect. refreshAccessToken() is
        // single-flight in api.js, so parallel callers share one
        // request; the guard below keeps reconnects from opening
        // several sockets while the refresh is in flight.
        if (!freshToken || isAccessTokenExpired()) {

            if (!this._tokenRefreshInFlight) {

                this._tokenRefreshInFlight = true;

                refreshAccessToken()
                    .then((refreshed) => {
                        this._tokenRefreshInFlight = false;
                        if (refreshed) {
                            this.connect(refreshed);
                        }
                    })
                    .catch(() => {
                        this._tokenRefreshInFlight = false;
                        this.shouldReconnect = false;
                    });

            }

            return;
        }

        const socket =
            new WebSocket(
                url,
                ["nexara." + freshToken]
            );

        // Supersede guard: any socket no longer owned by the
        // service (a newer connect replaced it, or an explicit
        // disconnect happened) must not schedule reconnects,
        // start heartbeats or dispatch events.
        this.socket = socket;

        this.lastAliveAt = Date.now();

        socket.onopen = () => {

            if (this.socket !== socket) {

                return;

            }

            this.reconnectAttempts = 0;

            this._startHeartbeat();

            this._flushPendingQueue();

        };

        socket.onmessage = (event) => {

            if (this.socket !== socket) {

                return;

            }

            this.lastAliveAt = Date.now();

            try {

                const data =
                    JSON.parse(event.data);

                // Show backend websocket errors
                if (data.event === "error") {

                    console.error(
                        "WebSocket:",
                        data.message,
                    );

                    return;

                }

                this.listeners.forEach(
                    listener => listener(data)
                );

            }

            catch (error) {

                console.error(
                    "Invalid websocket payload",
                    error,
                );

            }

        };

        socket.onclose = () => {

            if (this.socket !== socket) {

                // Superseded — a newer socket owns the slot
                // (or an explicit disconnect happened).
                return;

            }

            this.socket = null;

            this._stopHeartbeat();

            if (this.shouldReconnect) {

                this._scheduleReconnect();

            }

        };

        socket.onerror = (error) => {

            if (this.socket !== socket) {

                return;

            }

            console.error(
                "WebSocket error",
                error,
            );

        };

    }

    // ======================================================
    // Close the current socket WITHOUT touching listeners.
    //
    // Listeners survive reconnects on purpose: wiping them
    // here used to silently kill real-time updates — the
    // socket came back, but nothing was left to dispatch
    // the broadcast to the UI.
    // ======================================================

    _closeSocket() {

        const socket = this.socket;

        if (!socket) return;

        if (socket.readyState === WebSocket.CONNECTING) {

            // Closing a connecting socket makes the browser
            // log "WebSocket is closed before the connection
            // is established". Drop the handlers instead; the
            // connection resolves (or fails) without callbacks.
            this.socket = null;

            socket.onopen = null;
            socket.onmessage = null;
            socket.onerror = null;
            socket.onclose = null;

            return;

        }

        // Keep the slot owned by this socket: its own onclose
        // handler will null it, stop the heartbeat, and (when
        // shouldReconnect is still set) schedule the reconnect.
        socket.close();

    }

    // ======================================================
    // RECONNECT / HEARTBEAT
    // ======================================================

    _scheduleReconnect() {

        if (!this.shouldReconnect) return;

        const delay =
            Math.min(
                1000 * (2 ** this.reconnectAttempts),
                this.maxReconnectDelay
            );

        this.reconnectAttempts += 1;

        this.reconnectTimer =
            setTimeout(
                () => this._openSocket(),
                delay,
            );

    }

    _startHeartbeat() {

        this._stopHeartbeat();

        this.heartbeatTimer =
            setInterval(
                () => this._checkAlive(),
                this.heartbeatInterval,
            );

    }

    _stopHeartbeat() {

        if (this.heartbeatTimer) {

            clearInterval(this.heartbeatTimer);

            this.heartbeatTimer = null;

        }

    }

    _checkAlive() {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        const now = Date.now();

        if (now - this.lastAliveAt > this.staleThreshold) {

            logger.warn(
                "WebSocket heartbeat timeout, reconnecting"
            );

            // Closing triggers onclose -> reconnect
            this._closeSocket();

            return;

        }

        try {

            this.socket.send(
                JSON.stringify({
                    event: "ping",
                })
            );

        }

        catch (error) {

            logger.warn(
                "WebSocket send failed, reconnecting",
                error,
            );

            this._closeSocket();

        }

    }

    // ======================================================
    // OFFLINE QUEUE
    // ======================================================

    _enqueue(message) {
        this._pendingQueue.push({
            ...message,
            _queuedAt: Date.now(),
        });
        if (this._pendingQueue.length > this._pendingQueueMax) {
            this._pendingQueue.shift();
        }
        // Persist message sends to IndexedDB so they survive page
        // refresh while offline. Only actual messages are persisted
        // (typing/delivered/read signals are ephemeral).
        if (message.event === "message") {
            enqueueMessage(message).catch(() => {});
        }
    }

    _flushPendingQueue() {
        if (this._pendingQueue.length === 0) return;

        const queue = [...this._pendingQueue];
        this._pendingQueue = [];

        for (const msg of queue) {
            if (
                !this.socket ||
                this.socket.readyState !== WebSocket.OPEN
            ) {
                this._pendingQueue.push(msg);
                continue;
            }
            const { _queuedAt: _, ...payload } = msg;
            try {
                this.socket.send(JSON.stringify(payload));
            } catch {
                this._pendingQueue.push(msg);
            }
        }
    }

    // ======================================================
    // SEND MESSAGE
    // ======================================================

    sendMessage(message) {

        const payload = {
            event: "message",
            ...message,
        };

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            this._enqueue(payload);
            return;
        }

        this.socket.send(JSON.stringify(payload));

    }

    // ======================================================
    // TYPING
    // ======================================================

    sendTyping(conversationId) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        this.socket.send(

            JSON.stringify({

                event: "typing",

                conversation_id: conversationId,

            })

        );

    }

    // ======================================================
    // STOP TYPING
    // ======================================================

    stopTyping(conversationId) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        this.socket.send(

            JSON.stringify({

                event: "stop_typing",

                conversation_id: conversationId,

            })

        );

    }

    // ======================================================
    // CHAT OPEN / CLOSE (in-conversation presence)
    // ======================================================

    sendChatOpen(conversationId) {

        this._sendConversationEvent(
            "chat_open",
            conversationId,
        );

    }

    sendChatClose(conversationId) {

        this._sendConversationEvent(
            "chat_close",
            conversationId,
        );

    }

    _sendConversationEvent(event, conversationId) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        this.socket.send(

            JSON.stringify({
                event,
                conversation_id: conversationId,
            })

        );

    }

    // ======================================================
    // READ RECEIPT
    // ======================================================

    sendRead(
        conversationId,
        messageId,
    ) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        this.socket.send(

            JSON.stringify({

                event: "read",

                conversation_id: conversationId,

                message_id: messageId,

            })

        );

    }

    // ======================================================
    // DELIVERED RECEIPT
    // ======================================================

    sendDelivered(
        conversationId,
        messageId,
    ) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        this.socket.send(

            JSON.stringify({

                event: "delivered",

                conversation_id: conversationId,

                message_id: messageId,

            })

        );

    }

    // ======================================================
    // EDIT
    //
    // The edited content arrives already encrypted (Signal
    // ratchet); the server swaps the payload fields and the
    // plaintext never touches it.
    // ======================================================

    sendEdit({
        conversationId,
        messageId,
        encrypted,
    }) {

        const payload = {
            event: "edit",
            conversation_id: conversationId,
            message_id: messageId,
            ciphertext: encrypted.ciphertext,
            encrypted_key_sender: encrypted.encrypted_key_sender,
            encrypted_key_receiver: encrypted.encrypted_key_receiver,
            nonce: encrypted.nonce,
            recipient_keys: encrypted.recipient_keys || [],
            envelopes: encrypted.envelopes || [],
        };

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            this._enqueue(payload);
            return;
        }

        this.socket.send(JSON.stringify(payload));

    }

    // ======================================================
    // DELETE
    // ======================================================

    sendDelete(
        conversationId,
        messageId,
    ) {

        const payload = {
            event: "delete",
            conversation_id: conversationId,
            message_id: messageId,
        };

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            this._enqueue(payload);
            return;
        }

        this.socket.send(JSON.stringify(payload));

    }

    // ======================================================
    // VOICE / VIDEO CALL SIGNALING (WebRTC relay)
    //
    // The server relays offer/answer/ice/end between the
    // conversation members; media itself is peer-to-peer
    // (DTLS-SRTP encrypted) and never touches the server.
    // ======================================================

    sendCallEvent(
        event,
        conversationId,
        callId,
        extras = {},
    ) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        this.socket.send(

            JSON.stringify({

                event,

                conversation_id: conversationId,

                call_id: callId,

                ...extras,

            })

        );

    }

    // ======================================================
    // PING
    // ======================================================

    ping() {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        this.socket.send(

            JSON.stringify({

                event: "ping",

            })

        );

    }

    // ======================================================
    // LISTENERS
    // ======================================================

    onMessage(listener) {

        this.listeners.push(listener);

    }

    removeListener(listener) {

        this.listeners = this.listeners.filter(
            existing => existing !== listener
        );

    }

    removeListeners() {

        this.listeners = [];

    }

    // ======================================================
    // DISCONNECT
    // ======================================================

    disconnect() {

        this.shouldReconnect = false;

        this._stopHeartbeat();

        if (this.reconnectTimer) {

            clearTimeout(this.reconnectTimer);

            this.reconnectTimer = null;

        }

        this._closeSocket();

        this.removeListeners();

        this._pendingQueue = [];

    }

}

export default new WebSocketService();