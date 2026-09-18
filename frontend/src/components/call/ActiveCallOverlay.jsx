import { useCall } from "../../context/CallContext";

import "./Call.css";

export default function ActiveCallOverlay() {

    const {
        call,
        localStream,
        remoteStream,
        muted,
        videoEnabled,
        endCall,
        toggleMute,
        toggleVideo,
    } = useCall();

    const isVideo =
        call.callType === "video";

    const inCall =
        call.status === "in-call";

    const statusLabel =
        call.status === "ringing"
            ? "Ringing…"
            : call.status === "connecting"
                ? "Connecting…"
                : inCall
                    ? "In call"
                    : "Calling…";

    return (

        <div className="active-call-backdrop">

            <div className="active-call-card">

                {isVideo && remoteStream ? (

                    <video
                        className="call-remote-video"
                        ref={video => {
                            if (video) {
                                video.srcObject = remoteStream;
                            }
                        }}
                        autoPlay
                        playsInline
                    />

                ) : isVideo ? (

                    <div className="call-remote-placeholder">

                        <svg
                            width="56"
                            height="56"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                        </svg>

                        <div className="call-remote-name">
                            {call.peerName}
                        </div>

                        <div className="call-status-label">
                            {statusLabel}
                        </div>

                        <div
                            className={
                                call.e2ee
                                    ? "call-e2ee-badge"
                                    : "call-e2ee-badge warn"
                            }
                        >
                            <svg
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <rect x="3" y="11" width="18" height="11" rx="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            {call.e2ee
                                ? "End-to-end encrypted"
                                : "Media not encrypted"}
                        </div>

                    </div>

                ) : (

                    <div className="call-voice-box">

                        <div className="call-voice-avatar">
                            {call.peerName
                                ? call.peerName[0].toUpperCase()
                                : "?"}
                        </div>

                        <div className="call-remote-name">
                            {call.peerName}
                        </div>

                        <div className="call-status-label">
                            {statusLabel}
                        </div>

                    </div>

                )}

                {!isVideo && remoteStream && (

                    /* Voice calls have no <video> element, so the
                       remote audio track must be bound to an output
                       — otherwise the peer is completely silent. */
                    <audio
                        ref={audio => {
                            if (audio) {
                                audio.srcObject = remoteStream;
                            }
                        }}
                        autoPlay
                        playsInline
                    />

                )}

                {localStream && isVideo && (

                    <video
                        className="call-local-video"
                        ref={video => {
                            if (video) {
                                video.srcObject = localStream;
                            }
                        }}
                        autoPlay
                        muted
                        playsInline
                    />

                )}

                <div className="call-controls">

                    <button
                        type="button"
                        className={
                            muted
                                ? "call-control call-control-active"
                                : "call-control"
                        }
                        onClick={toggleMute}
                        title={muted ? "Unmute" : "Mute"}
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
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" x2="12" y1="19" y2="22" />
                        </svg>
                    </button>

                    {isVideo && videoEnabled && localStream && (

                        <button
                            type="button"
                            className={
                                videoEnabled
                                    ? "call-control"
                                    : "call-control call-control-active"
                            }
                            onClick={toggleVideo}
                            title="Turn camera off"
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
                                <path d="m22 8-6 4 6 4V8Z" />
                                <rect x="2" y="6" width="14" height="12" rx="2" />
                            </svg>
                        </button>

                    )}

                    <button
                        type="button"
                        className="call-control call-control-end"
                        onClick={endCall}
                        title="End call"
                    >
                        <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                        </svg>
                    </button>

                </div>

            </div>

        </div>

    );

}
