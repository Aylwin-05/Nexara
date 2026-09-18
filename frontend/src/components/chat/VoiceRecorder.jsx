import { useEffect, useRef, useState } from "react";

import "./Chat.css";

function MicIcon() {
    return (
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
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <path d="M12 19v3" />
        </svg>
    );
}

export default function VoiceRecorder({
    onRecorded,
}) {

    const [recording, setRecording] =
        useState(false);

    const [seconds, setSeconds] =
        useState(0);

    const mediaRecorderRef =
        useRef(null);

    const streamRef =
        useRef(null);

    const chunksRef =
        useRef([]);

    const timerRef =
        useRef(null);

    // ======================================================
    // Start Recording
    // ======================================================

    async function startRecording() {

        try {

            const stream =
                await navigator.mediaDevices.getUserMedia({

                    audio: true,

                });

            streamRef.current =
                stream;

            chunksRef.current = [];

            const recorder =
                new MediaRecorder(stream);

            mediaRecorderRef.current =
                recorder;

            recorder.ondataavailable =
                (event) => {

                    if (
                        event.data &&
                        event.data.size > 0
                    ) {

                        chunksRef.current.push(
                            event.data
                        );

                    }

                };

            recorder.onstop =
                async () => {

                    const blob =
                        new Blob(

                            chunksRef.current,

                            {
                                type:
                                    recorder.mimeType ||
                                    "audio/webm",
                            }

                        );

                    const file =
                        new File(

                            [blob],

                            `voice_${Date.now()}.webm`,

                            {
                                type:
                                    blob.type,
                            }

                        );

                    onRecorded(file);

                    stream
                        .getTracks()
                        .forEach(
                            track =>
                                track.stop()
                        );

                };

            recorder.start();

            setRecording(true);

            setSeconds(0);

            timerRef.current =
                setInterval(() => {

                    setSeconds(
                        previous =>
                            previous + 1
                    );

                }, 1000);

        }

        catch (error) {

            console.error(error);

            alert(
                "Microphone permission denied."
            );

        }

    }

    // ======================================================
    // Stop Recording
    // ======================================================

    function stopRecording() {

        if (
            mediaRecorderRef.current &&
            recording
        ) {

            mediaRecorderRef.current.stop();

        }

        clearInterval(
            timerRef.current
        );

        setRecording(false);

    }

    // ======================================================
    // Cancel Recording
    // ======================================================

    function cancelRecording() {

        if (
            mediaRecorderRef.current &&
            recording
        ) {

            mediaRecorderRef.current.stop();

        }

        chunksRef.current = [];

        clearInterval(
            timerRef.current
        );

        streamRef.current
            ?.getTracks()
            .forEach(
                track => track.stop()
            );

        setRecording(false);

        setSeconds(0);

    }

    // ======================================================
    // Cleanup
    // ======================================================

    useEffect(() => {

        return () => {

            clearInterval(
                timerRef.current
            );

            streamRef.current
                ?.getTracks()
                .forEach(
                    track => track.stop()
                );

        };

    }, []);

    const minutes =
        String(
            Math.floor(seconds / 60)
        ).padStart(2, "0");

    const secs =
        String(
            seconds % 60
        ).padStart(2, "0");

    // ======================================================
    // UI
    // ======================================================

    if (!recording) {

        return (

            <button
                type="button"
                className="icon-btn"
                aria-label="Record voice message"
                onClick={startRecording}
            >

                <MicIcon />

            </button>

        );

    }

    return (

        <div
            className="voice-recorder"
        >

            <span className="rec-dot" />

            <span className="rec-time">

                {minutes}:{secs}

            </span>

            <button
                type="button"
                className="rec-stop"
                aria-label="Send recording"
                onClick={stopRecording}
            >

                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                >
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>

            </button>

            <button
                type="button"
                className="rec-cancel"
                aria-label="Cancel recording"
                onClick={cancelRecording}
            >

                <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                >
                    <path d="M18 6 6 18M6 6l12 12" />
                </svg>

            </button>

        </div>

    );

}