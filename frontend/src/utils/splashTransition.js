// One-shot channel for the splash -> login shared-element
// handover. Splash records the on-screen rectangles of its shield
// and wordmark right before navigating; Login consumes them to
// run a FLIP animation from those exact spots into place.
//
// The snapshot lives in memory AND sessionStorage: the in-memory
// copy is the fast path, while sessionStorage covers an Android
// WebView renderer kill/restore (or a reload) landing inside the
// handover window — without it Login mounts with no rects and
// silently skips the animation.
//
// Rects expire quickly so a stale snapshot can never hijack a
// much later visit to /login (e.g. after logout).

const STORAGE_KEY = "nexara.splashRects";
const MAX_AGE_MS = 3000;

let snapshot = null;

function readStored() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return null;
        }

        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function clearStored() {
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch {
        // Private mode / storage disabled — memory copy is enough.
    }
}

export function saveSplashRects(next) {
    snapshot = { ...next, ts: Date.now() };

    try {
        sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(snapshot)
        );
    } catch {
        // Same as above — best effort only.
    }
}

export function takeSplashRects() {

    if (!snapshot) {
        snapshot = readStored();
    }

    if (!snapshot) {
        return null;
    }

    const fresh =
        Date.now() - snapshot.ts <= MAX_AGE_MS;

    const data = fresh ? snapshot : null;

    snapshot = null;
    clearStored();

    return data;
}
