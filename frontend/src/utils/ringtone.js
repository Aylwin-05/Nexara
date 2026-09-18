// ==========================================================
// Call ringtone (Web Audio synth — no asset file required).
//
// A soft "phone ring" (dual-tone beat) that repeats until the
// call is answered, declined or ends. Played for both the
// incoming side (callee hears it immediately) and the outgoing
// side while it rings. The native shell disables the WebView's
// "require user gesture" media gate (MainActivity), so the
// incoming tone can start without a tap.
// ==========================================================

const RING_FREQS = [425, 480]; // classic PSTN ring cadence

const BEAT_MS = 180; // audible length of one beat
const RING_INTERVAL_MS = 2400; // time between rings

let ctx = null;
let timer = null;
let active = false;

function ensureContext() {

    if (!ctx) {

        const AudioCtor =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioCtor) return null;

        ctx = new AudioCtor();

    }

    if (ctx.state === "suspended") {

        void ctx.resume();

    }

    return ctx;

}

// One short dual-frequency beep (the "ring" pulse).
function beep(context) {

    const now = context.currentTime;

    for (const freq of RING_FREQS) {

        const osc = context.createOscillator();
        const gain = context.createGain();

        osc.type = "sine";
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.16, now + 0.02);
        gain.gain.setValueAtTime(0.16, now + BEAT_MS / 1000 - 0.04);
        gain.gain.linearRampToValueAtTime(0.0001, now + BEAT_MS / 1000);

        osc.connect(gain);
        gain.connect(context.destination);

        osc.start(now);
        osc.stop(now + BEAT_MS / 1000 + 0.05);

    }

}

function ringOnce() {

    const context = ensureContext();

    if (!context || context.state !== "running") return;

    beep(context);

}

export function startRingtone() {

    if (active) return;

    const context = ensureContext();

    if (!context) return;

    active = true;

    // One beat immediately, then repeat on the ring cadence.
    void context.resume();
    ringOnce();

    timer = setInterval(ringOnce, RING_INTERVAL_MS);

}

export function stopRingtone() {

    active = false;

    if (timer) {

        clearInterval(timer);

        timer = null;

    }

}