import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

import { useAuth } from "./AuthContext";
import { useChatSocket } from "./ChatSocketContext";

import websocketService from "../services/websocketService";
import api from "../api/api";

import {
    supportsFrameEncryption,
    deriveCallKeyPair,
    buildWorkerOptions,
    generateCallNonce,
    encodeCallNonce,
} from "../crypto/callCrypto";

import IncomingCallModal from "../components/call/IncomingCallModal";
import ActiveCallOverlay from "../components/call/ActiveCallOverlay";
import { logger } from "../utils/logger.js";
import { startRingtone, stopRingtone } from "../utils/ringtone";

const CallContext = createContext(null);

const FALLBACK_ICE_SERVERS = [
    {
        urls: "stun:stun.l.google.com:19302",
    },
];

const FRAME_WORKER_PATH = "/frameEncryptionWorker.js";

function emptyCall() {

    return {

        conversationId: null,

        callId: null,

        callType: "voice",

        peerId: null,

        peerName: "Unknown",

        outgoing: false,

        status: "idle", // ringing | connecting | in-call | ended

        e2ee: false,

    };

}

export function CallProvider({ children }) {

    const { user } = useAuth();

    const {
        conversations,
        subscribe,
    } = useChatSocket();

    const userRef = useRef(user);

    const [incomingCall, setIncomingCall] =
        useState(null);

    const [call, setCall] =
        useState(emptyCall());

    const [localStream, setLocalStream] =
        useState(null);

    const [remoteStream, setRemoteStream] =
        useState(null);

    const [muted, setMuted] =
        useState(false);

    const [videoEnabled, setVideoEnabled] =
        useState(true);

    const peerConnectionRef = useRef(null);

    const callRef = useRef(call);

    const incomingRef = useRef(incomingCall);

    const iceServersRef = useRef(FALLBACK_ICE_SERVERS);

    const localStreamRef = useRef(null);

    const remoteStreamRef = useRef(null);

    // Keys derived at offer/answer time, kept until both sides
    // confirm the derivation matches (call_key_hash) and the
    // encoded-stream transform can be attached safely.
    const pendingKeysRef = useRef(null);

    // Remote ICE candidates that arrived before the remote
    // description was negotiated are parked here and added once
    // setRemoteDescription() succeeds.
    const pendingIceRef = useRef([]);

    // The frame-encryption worker attached to the encoded media
    // streams, tracked so it can be terminated on hang-up and
    // not leak a thread per call.
    const frameWorkerRef = useRef(null);

    // Screen wake lock held while a call is active (the call UI
    // must not let the display sleep mid-conversation).
    const wakeLockRef = useRef(null);

    // Call-record bookkeeping for the call-history feature. A log
    // is created the moment the call CONNECTS (not on the offer),
    // so only real conversations appear in history; it is then
    // finalized as "answered" with its duration on hang-up.
    const callLogRef = useRef(null);            // { id, callId }

    // Wall-clock timestamp when the peer connection reached
    // "connected", used to compute the call duration on end.
    const callConnectedAtRef = useRef(null);

    // Fetch ICE/TURN config once (falls back to public STUN).
    useEffect(() => {

        let cancelled = false;

        api.get("/call/config")
            .then(response => {
                if (!cancelled) {
                    iceServersRef.current =
                        response.data?.ice_servers ??
                        FALLBACK_ICE_SERVERS;
                }
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };

    }, []);

    useEffect(() => {

        userRef.current = user;

    }, [user]);

    useEffect(() => {

        callRef.current = call;

    }, [call]);

    useEffect(() => {

        incomingRef.current = incomingCall;

    }, [incomingCall]);

    useEffect(() => {

        localStreamRef.current = localStream;

    }, [localStream]);

    useEffect(() => {

        remoteStreamRef.current = remoteStream;

    }, [remoteStream]);

    //=====================================================
    // Call-history recording
    //
    // One CallLog per CONNECTED call. Creating it on connect
    // (not on the ringing offer) means the call history only
    // lists real conversations. The same row is finalized as
    // "answered" with its duration when the call ends.
    //=====================================================

    async function recordCallLog() {

        const current = callRef.current;

        if (!current?.callId) return;

        if (callLogRef.current?.callId === current.callId) {

            return;

        }

        const peerId = current.peerId;

        if (!peerId) return;

        // Only the OUTGOING (caller) side writes the history row.
        // The single row is visible to both parties because the
        // backend returns any log where the caller OR receiver is
        // the current user — creating it from the callee too would
        // double count every call.
        if (current.outgoing !== true) return;

        try {

            const { data } = await api.post(
                "/call/log",
                null,
                {
                    params: {
                        receiver_id: peerId,
                        conversation_id:
                            current.conversationId,
                        call_type:
                            current.callType ||
                            "voice",
                        status: "missed",
                    },
                }
            );

            callLogRef.current = {
                id: data?.id,
                callId: current.callId,
            };

            callConnectedAtRef.current =
                Date.now();

        }
        catch (error) {

            logger.warn(
                "Failed to record call log:",
                error,
            );

            callLogRef.current = {
                id: null,
                callId: current.callId,
            };

        }

    }

    async function finalizeCallLog() {

        const record =
            callLogRef.current;

        if (!record) return;

        callLogRef.current = null;

        if (!record.id) return;

        const endedAt = Date.now();

        const connectedAt =
            callConnectedAtRef.current;

        const durationSeconds =
            connectedAt
                ? Math.max(
                    0,
                    Math.round(
                        (endedAt - connectedAt) / 1000
                    )
                )
                : 0;

        try {

            await api.put(
                `/call/${record.id}/end`,
                null,
                {
                    params: {
                        duration_seconds:
                            durationSeconds,
                    },
                }
            );

        }
        catch (error) {

            logger.warn(
                "Failed to finalize call log:",
                error,
            );

        }

        finally {

            callConnectedAtRef.current = null;

        }

    }

    //=====================================================
    // Media + peer connection teardown
    //=====================================================

    async function cleanup() {

        // Finalize the call-history row (mark answered + duration)
        // for any call that actually connected. No-op when no log
        // row was created (missed/declined calls create none).
        void finalizeCallLog();

        const peer =
            peerConnectionRef.current;

        if (peer) {

            try {
                peer.onicecandidate = null;
                peer.ontrack = null;
                peer.onconnectionstatechange = null;
                peer.close();
            }
            catch (e) {
                console.error(e);
            }

            peerConnectionRef.current = null;

        }

        // Tear down the frame-encryption worker once the peer
        // (and its encoded streams) is closed so every completed
        // call releases its worker thread.
        const frameWorker = frameWorkerRef.current;

        if (frameWorker) {

            try {
                frameWorker.terminate();
            }
            catch (e) {
                console.error(e);
            }

            frameWorkerRef.current = null;

        }

        const local = localStreamRef.current;

        if (local) {

            for (const track of local.getTracks()) {

                track.stop();

            }

        }

        localStreamRef.current = null;

        setLocalStream(null);

        const remote = remoteStreamRef.current;

        if (remote) {

            for (const track of remote.getTracks()) {

                track.stop();

            }

        }

        remoteStreamRef.current = null;

        setRemoteStream(null);

        pendingKeysRef.current = null;

        pendingIceRef.current = [];

        stopRingtone();

        releaseWakeLock();

        setMuted(false);

        setVideoEnabled(true);

        callRef.current = emptyCall();

        setCall(emptyCall());

        setIncomingCall(null);

        incomingRef.current = null;

    }

    //=====================================================
    // Screen wake lock: keep the display on during a call
    //=====================================================

    async function acquireWakeLock() {

        if (!("wakeLock" in navigator)) return;

        try {

            wakeLockRef.current =
                await navigator.wakeLock.request("screen");

        }
        catch (e) {

            // Unsupported or denied — the call still proceeds;
            // only the auto-sleep protection is skipped.
            wakeLockRef.current = null;

        }

    }

    function releaseWakeLock() {

        if (wakeLockRef.current) {

            try {

                void wakeLockRef.current.release();

            }
            catch (e) {

                // Already released by the platform.

            }

            wakeLockRef.current = null;

        }

    }

    //=====================================================
    // Find the peer's display name for a private
    // conversation (used for incoming calls).
    //=====================================================

    function peerNameFor(conversationId, fallbackId) {

        const conv = conversations.find(
            c => c.id === conversationId
        );

        return (
            conv?.other_user?.display_name ??
            fallbackId ??
            "Unknown"
        );

    }

    //=====================================================
    // ICE candidate -> signaling relay
    //=====================================================

    function handleIceCandidate(event) {

        const current = callRef.current;

        if (
            !current.callId ||
            !current.peerId ||
            !event.candidate
        ) {
            return;
        }

        websocketService.sendCallEvent(
            "call_ice",
            current.conversationId,
            current.callId,
            {
                to: current.peerId,
                candidate: event.candidate.toJSON(),
            }
        );

    }

    // A track event may arrive without a MediaStream container
    // (some browsers / m-lines); build one so the overlay always
    // has something to render.
    function remoteStreamFor(event) {

        if (event.streams?.[0]) return event.streams[0];

        if (event.track) return new MediaStream([event.track]);

        return null;

    }

    // Add ICE candidates that arrived before the remote
    // description was negotiated.
    async function flushPendingIce(peer) {

        const queue = pendingIceRef.current;

        pendingIceRef.current = [];

        for (const candidate of queue) {

            try {

                await peer?.addIceCandidate(candidate);

            }
            catch (e) {

                logger.warn(
                    "Failed to add queued ICE candidate:",
                    e,
                );

            }

        }

    }

    //=====================================================
    // WebRTC peer setup shared by caller + callee
    //=====================================================

    async function setupPeer(stream, onTrack, onStateChange) {

        const peer = new RTCPeerConnection({
            iceServers: iceServersRef.current,
        });

        peer.onicecandidate =
            handleIceCandidate;

        peer.ontrack =
            onTrack;

        peer.onconnectionstatechange =
            onStateChange;

        peerConnectionRef.current = peer;

        if (stream) {

            for (const track of stream.getTracks()) {

                peer.addTrack(track, stream);

            }

        }

        return peer;

    }

    // ======================================================
    // Insertable-stream frame encryption
    //
    // Encrypts every outgoing audio/video frame with the
    // per-call send key and decrypts incoming frames with the
    // recv key. Both keys are derived locally from the account
    // sync secret — never transmitted.
    // ======================================================

    async function attachFrameEncryption(peer, keys) {

        const worker = new Worker(
            FRAME_WORKER_PATH
        );

        frameWorkerRef.current = worker;

        for (const sender of peer.getSenders()) {

            try {

                const streams =
                    await sender.createEncodedStreams();

                const transform =
                    new RTCRtpScriptTransform(
                        worker,
                        buildWorkerOptions(
                            "encrypt",
                            keys.sendKey,
                        ),
                    );

                streams.readable
                    .pipeThrough(transform)
                    .pipeTo(streams.writable)
                    .catch(() => {});

            }
            catch (e) {

                logger.warn(
                    "Sender encryption unavailable:",
                    e,
                );

            }

        }

        const originalOnTrack = peer.ontrack;

        peer.ontrack = async (event) => {

            try {

                const receiver =
                    event.receiver ?? event.track?.receiver;

                if (receiver?.createEncodedStreams) {

                    const streams =
                        await receiver.createEncodedStreams();

                    const transform =
                        new RTCRtpScriptTransform(
                            worker,
                            buildWorkerOptions(
                                "decrypt",
                                keys.recvKey,
                            ),
                        );

                    streams.readable
                        .pipeThrough(transform)
                        .pipeTo(streams.writable)
                        .catch(() => {});

                }

            }
            catch (e) {

                logger.warn(
                    "Receiver decryption unavailable:",
                    e,
                );

            }

            originalOnTrack?.(event);

        };

    }

    //=====================================================
    // Start an outgoing voice/video call
    //=====================================================

    async function startCall(
        conversationId,
        callType,
        peerId,
        peerName,
    ) {

        if (callRef.current.callId) return;

        try {

            const stream =
                await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: callType === "video",
                });

            setLocalStream(stream);

            localStreamRef.current = stream;

            setVideoEnabled(callType === "video");

            const callId = crypto.randomUUID();

            // Nonce is generated HERE and relayed in the offer so
            // the callee derives identical keys. On a non-secure
            // context or a missing sync secret the derivation is
            // a no-op: the call proceeds over DTLS-SRTP instead.
            let callKeys = null;

            let nonceB64 = null;

            if (supportsFrameEncryption()) {

                const nonce = generateCallNonce();

                nonceB64 = encodeCallNonce(nonce);

                try {

                    callKeys =
                        await deriveCallKeyPair(
                            callId,
                            true,
                            nonce,
                        );

                }
                catch (e) {

                    logger.warn(
                        "Call key derivation failed, using DTLS-SRTP:",
                        e,
                    );

                    callKeys = null;

                }

            }

            pendingKeysRef.current = callKeys
                ? {
                    keys: callKeys,
                    keyHash: callKeys.keyHash,
                }
                : null;

            callRef.current = {
                conversationId,
                callId,
                callType,
                peerId,
                peerName,
                outgoing: true,
                status: "ringing",
                e2ee: false,
            };

            setCall(callRef.current);

            const peer =
                await setupPeer(
                    stream,
                    (event) => {
                        setRemoteStream(remoteStreamFor(event));
                    },
                    () => {},
                );

            peer.onconnectionstatechange = () => {

                const current = callRef.current;

                if (!current.callId) return;

                if (
                    peer.connectionState === "connected"
                ) {

                    setCall(previous => ({
                        ...previous,
                        status: "in-call",
                    }));

                    // The call connected — write the history row
                    // for the caller's outgoing call.
                    void recordCallLog();

                }

                else if (
                    ["failed", "disconnected", "closed"]
                        .includes(peer.connectionState)
                ) {

                    if (
                        peer.connectionState === "failed" ||
                        peer.connectionState === "closed"
                    ) {

                        endCall();

                    }

                }

            };

            const offer =
                await peer.createOffer();

            await peer.setLocalDescription(offer);

            websocketService.sendCallEvent(
                "call_offer",
                conversationId,
                callId,
                {
                    call_type: callType,
                    sdp: offer,
                    ...(nonceB64
                        ? { call_nonce: nonceB64 }
                        : {}),
                    ...(callKeys?.keyHash
                        ? { call_key_hash: callKeys.keyHash }
                        : {}),
                }
            );

        }

        catch (error) {

            console.error(error);

            cleanup();

        }

    }

    //=====================================================
    // Accept an incoming call (async: caller may hang up)
    //=====================================================

    async function answerCall() {

        const incoming =
            incomingRef.current;

        if (!incoming) return;

        try {

            const stream =
                await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: incoming.callType === "video",
                });

            setLocalStream(stream);

            localStreamRef.current = stream;

            setVideoEnabled(incoming.callType === "video");

            setIncomingCall(null);

            // Derive with the caller's relayed nonce, then only
            // enable frame encryption when BOTH sides derive the
            // same base secret (matching call_key_hash). A key
            // mismatch means the media leg stays on DTLS-SRTP
            // instead of silently producing garbled audio/video.
            let callKeys = null;

            let keyMatch = false;

            if (
                supportsFrameEncryption() &&
                incoming.nonceB64
            ) {

                try {

                    callKeys =
                        await deriveCallKeyPair(
                            incoming.callId,
                            false,
                            incoming.nonceB64,
                        );

                }
                catch (e) {

                    logger.warn(
                        "Call key derivation failed, using DTLS-SRTP:",
                        e,
                    );

                    callKeys = null;

                }

                keyMatch =
                    Boolean(
                        callKeys &&
                        callKeys.keyHash &&
                        incoming.offerKeyHash &&
                        callKeys.keyHash ===
                            incoming.offerKeyHash
                    );

            }

            callRef.current = {
                conversationId: incoming.conversationId,
                callId: incoming.callId,
                callType: incoming.callType,
                peerId: incoming.from,
                peerName: incoming.peerName,
                outgoing: false,
                status: "connecting",
                e2ee: keyMatch,
            };

            setCall(callRef.current);

            const peer = await setupPeer(
                stream,
                (event) => {
                    setRemoteStream(remoteStreamFor(event));
                },
                () => {},
            );

            if (keyMatch) {

                try {

                    await attachFrameEncryption(
                        peer,
                        callKeys,
                    );

                }
                catch (e) {

                    logger.warn(
                        "Frame encryption failed, using DTLS-SRTP:",
                        e,
                    );

                    setCall(previous => ({
                        ...previous,
                        e2ee: false,
                    }));

                }

            }

            peer.onconnectionstatechange = () => {

                const current = callRef.current;

                if (!current.callId) return;

                if (
                    peer.connectionState === "connected"
                ) {

                    setCall(previous => ({
                        ...previous,
                        status: "in-call",
                    }));

                }

                else if (
                    peer.connectionState === "failed" ||
                    peer.connectionState === "closed"
                ) {

                    endCall();

                }

            };

            await peer.setRemoteDescription(
                new RTCSessionDescription(
                    incoming.offer
                )
            );

            // Candidates collected while the remote description
            // was unknown become valid now.
            await flushPendingIce(peer);

            const answer =
                await peer.createAnswer();

            await peer.setLocalDescription(answer);

            websocketService.sendCallEvent(
                "call_answer",
                incoming.conversationId,
                incoming.callId,
                {
                    to: incoming.from,
                    sdp: answer,
                    ...(keyMatch && callKeys?.keyHash
                        ? { answer_key_hash: callKeys.keyHash }
                        : {}),
                }
            );

        }

        catch (error) {

            console.error(error);

            cleanup();

        }

    }

    //=====================================================
    // Decline an incoming call
    //=====================================================

    function declineCall() {

        const incoming =
            incomingRef.current;

        if (!incoming) return;

        websocketService.sendCallEvent(
            "call_end",
            incoming.conversationId,
            incoming.callId,
            {
                to: incoming.from,
            }
        );

        cleanup();

    }

    //=====================================================
    // End the active call (also used on remote hang-up)
    //=====================================================

    function endCall() {

        const current = callRef.current;

        if (current.callId) {

            websocketService.sendCallEvent(
                "call_end",
                current.conversationId,
                current.callId,
                {
                    to: current.peerId,
                }
            );

        }

        cleanup();

    }

    //=====================================================
    // Media toggles
    //=====================================================

    function toggleMute() {

        setMuted(previous => {

            const next = !previous;

            localStream?.getAudioTracks().forEach(
                track => {
                    track.enabled = !next;
                }
            );

            return next;

        });

    }

    function toggleVideo() {

        setVideoEnabled(previous => {

            const next = !previous;

            localStream?.getVideoTracks().forEach(
                track => {
                    track.enabled = next;
                }
            );

            return next;

        });

    }

    //=====================================================
    // Signaling events
    //=====================================================

    useEffect(() => {

        const unsubscribe =
            subscribe(async (event) => {

                const selfId =
                    userRef.current?.id;

                if (
                    !event.conversation_id ||
                    !event.call_id ||
                    event.from === selfId
                ) {
                    return;
                }

                const current =
                    callRef.current;

                switch (event.event) {

                    case "call_offer": {

                        // Busy: politely reject another offer.
                        if (current.callId) {

                            websocketService.sendCallEvent(
                                "call_end",
                                event.conversation_id,
                                event.call_id,
                                {
                                    to: event.from,
                                }
                            );

                            return;

                        }

                        incomingRef.current = {
                            conversationId:
                                event.conversation_id,
                            callId: event.call_id,
                            callType:
                                event.call_type ?? "voice",
                            from: event.from,
                            offer: event.sdp,
                            nonceB64:
                                event.call_nonce ?? null,
                            offerKeyHash:
                                event.call_key_hash ?? null,
                            peerName:
                                peerNameFor(
                                    event.conversation_id,
                                    event.from,
                                ),
                        };

                        setIncomingCall(
                            incomingRef.current
                        );

                        break;

                    }

                    case "call_answer": {

                        if (
                            current.callId ===
                            event.call_id
                        ) {

                            try {

                                const peer =
                                    peerConnectionRef.current;

                                await peer?.setRemoteDescription(
                                    new RTCSessionDescription(
                                        event.sdp
                                    )
                                );

                                const pending =
                                    pendingKeysRef.current;

                                if (
                                    peer &&
                                    pending &&
                                    event.answer_key_hash &&
                                    event.answer_key_hash ===
                                        pending.keyHash
                                ) {

                                    try {

                                        await attachFrameEncryption(
                                            peer,
                                            pending.keys,
                                        );

                                        setCall(previous => ({
                                            ...previous,
                                            e2ee: true,
                                        }));

                                    }
                                    catch (e) {

                                        logger.warn(
                                            "Frame encryption failed, using DTLS-SRTP:",
                                            e,
                                        );

                                    }

                                }

                                await flushPendingIce(peer);

                            }

                            catch (e) {

                                console.error(e);

                            }

                        }

                        break;

                    }

                    case "call_ice":

                        if (
                            current.callId ===
                            event.call_id &&
                            event.candidate
                        ) {

                            const peer =
                                peerConnectionRef.current;

                            if (peer?.remoteDescription) {

                                Promise.resolve(
                                    peer.addIceCandidate(
                                        event.candidate
                                    )
                                ).catch(e => {

                                    logger.warn(
                                        "Failed to add ICE candidate:",
                                        e,
                                    );

                                });

                            }

                            else {

                                pendingIceRef.current.push(
                                    event.candidate
                                );

                            }

                        }

                        break;

                    case "call_end":

                        if (
                            current.callId ===
                            event.call_id
                        ) {

                            cleanup();

                        }

                        else if (
                            incomingRef.current?.callId ===
                            event.call_id
                        ) {

                            setIncomingCall(null);

                        }

                        break;

                }

            });

        return unsubscribe;

    }, [subscribe, conversations]);

    //=====================================================
    // Ringtone
    //
    // Incoming: rings as soon as an offer arrives. Outgoing:
    // rings while MY call is ringing/connecting. Anything else
    // (answered, declined, ended) silences it. Effects keep this
    // self-contained — no scattered start/stop calls.
    //=====================================================

    useEffect(() => {

        if (incomingCall) {

            startRingtone();

            return;

        }

        if (
            call.callId &&
            call.outgoing &&
            (call.status === "ringing" ||
                call.status === "connecting")
        ) {

            startRingtone();

            return;

        }

        stopRingtone();

    }, [incomingCall, call.callId, call.outgoing, call.status]);

    //=====================================================
    // Screen wake lock while a call is active
    //=====================================================

    useEffect(() => {

        if (call.callId) {

            void acquireWakeLock();

        }
        else {

            releaseWakeLock();

        }

    }, [call.callId]);

    // The wake lock is dropped by the platform if the app goes to
    // the background; re-acquire when it comes back and a call is
    // still live.
    useEffect(() => {

        function handleVisibility() {

            if (
                document.visibilityState === "visible" &&
                callRef.current?.callId &&
                !wakeLockRef.current
            ) {

                void acquireWakeLock();

            }

        }

        document.addEventListener(
            "visibilitychange",
            handleVisibility
        );

        return () => {

            document.removeEventListener(
                "visibilitychange",
                handleVisibility
            );

        };

    }, []);

    //=====================================================
    // Auto-end when the page goes away / unmounts
    //=====================================================

    useEffect(() => {

        function handlePageHide() {

            const current = callRef.current;

            if (current.callId) {

                websocketService.sendCallEvent(
                    "call_end",
                    current.conversationId,
                    current.callId,
                    {
                        to: current.peerId,
                    }
                );

            }

        }

        window.addEventListener(
            "pagehide",
            handlePageHide
        );

        return () => {

            window.removeEventListener(
                "pagehide",
                handlePageHide
            );

            cleanup();

        };

    }, []);

    const value = {

        call,

        incomingCall,

        localStream,

        remoteStream,

        muted,

        videoEnabled,

        startCall,

        answerCall,

        declineCall,

        endCall,

        toggleMute,

        toggleVideo,

    };

    return (

        <CallContext.Provider value={value}>

            {children}

            {incomingCall && (

                <IncomingCallModal
                    call={incomingCall}
                    onAnswer={answerCall}
                    onDecline={declineCall}
                />

            )}

            {call.callId && call.status !== "ended" && (

                <ActiveCallOverlay />

            )}

        </CallContext.Provider>

    );

}

export function useCall() {

    return useContext(CallContext);

}
