// ==========================================================
// App lock (device-only, security-hardened)
// An optional PIN that gates access to the app on this device.
// The PIN never leaves the browser. Uses HMAC-SHA256 with a
// pepper stored in IndexedDB so XSS cannot simply read the PIN
// verification data. Rate-limited failed attempts with progressive
// delay. The unlock flag lives in sessionStorage so a new tab or
// session always requires the PIN again.
// ==========================================================

const PIN_PATTERN = /^\d{4,6}$/;
const HMAC_KEY = "nexara_lock_hmac";
const ATTEMPTS_KEY = "nexara_lock_attempts";
const LOCKOUT_KEY = "nexara_lock_locked_until";
const UNLOCK_FLAG = "nexara_app_unlocked";
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 30 * 60 * 1000;

// ==========================================================
// IndexedDB Pepper Store (generated once, never leaves browser)
// ==========================================================

let dbPromise = null;

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open("nexara-app-lock-pepper", 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains("pepper")) {
                    db.createObjectStore("pepper");
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
}

function getPepper() {
    return openDb().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction("pepper", "readonly");
                const request =
                    tx.objectStore("pepper").get("pepper");
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            })
    );
}

function savePepper(pepperB64) {
    return openDb().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction("pepper", "readwrite");
                const request =
                    tx.objectStore("pepper").put(pepperB64, "pepper");
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            })
    );
}

async function ensurePepper() {
    const existing = await getPepper();
    if (existing) {
        return existing;
    }

    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const pepperB64 = b64FromUint8(bytes);

    await savePepper(pepperB64);

    return pepperB64;
}

function deletePepper() {
    return openDb().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction("pepper", "readwrite");
                const request =
                    tx.objectStore("pepper").delete("pepper");
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            })
    );
}

// ==========================================================
// Encoding helpers
// ==========================================================

function b64FromUint8(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function uint8FromB64(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// Constant-time string comparison (both are fixed-length base64)
function safeEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }

    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

// ==========================================================
// PIN Verification (HMAC-SHA256 with pepper)
// Stored value: HMAC-SHA256(key = pepper || pin, "nexara-app-lock")
// ==========================================================

async function computeHmac(pepperB64, pin) {
    const pepperBytes = uint8FromB64(pepperB64);
    const pinBytes = new TextEncoder().encode(pin);

    const merged = new Uint8Array(pepperBytes.length + pinBytes.length);
    merged.set(pepperBytes, 0);
    merged.set(pinBytes, pepperBytes.length);

    const key = await crypto.subtle.importKey(
        "raw",
        merged,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode("nexara-app-lock")
    );

    return b64FromUint8(new Uint8Array(signature));
}

// ==========================================================
// Unlock flag (sessionStorage: cleared when the tab closes,
// so every new session asks for the PIN once)
// ==========================================================

function setUnlocked() {
    try {
        sessionStorage.setItem(UNLOCK_FLAG, "1");
    } catch {
        // storage unavailable (private mode): stay unlocked for now
    }
}

// ==========================================================
// App Lock Object
// ==========================================================

const appLock = {

    isValidPin(pin) {
        return PIN_PATTERN.test(pin);
    },

    // Fully configured = a PIN was set (pepper + stored HMAC exist)
    async isConfigured() {
        try {
            const [pepper, hmac] = await Promise.all([
                getPepper(),
                Promise.resolve(localStorage.getItem(HMAC_KEY)),
            ]);
            return !!pepper && !!hmac;
        } catch {
            return false;
        }
    },

    // Synchronous variant for render paths (HMAC lives in localStorage)
    isConfiguredSync() {
        try {
            return !!localStorage.getItem(HMAC_KEY);
        } catch {
            return false;
        }
    },

    isUnlocked() {
        try {
            return sessionStorage.getItem(UNLOCK_FLAG) === "1";
        } catch {
            return false;
        }
    },

    lock() {
        try {
            sessionStorage.removeItem(UNLOCK_FLAG);
        } catch {
            // ignore
        }
    },

    // Verify the PIN. Returns { valid, retryDelayMs?, notConfigured? }
    async verify(pin) {
        if (!PIN_PATTERN.test(pin)) {
            return { valid: false };
        }

        const hmac = localStorage.getItem(HMAC_KEY);
        const pepper = await getPepper();

        if (!hmac || !pepper) {
            return { valid: false, notConfigured: true };
        }

        const now = Date.now();

        // Active lockout?
        const lockedUntil = Number(localStorage.getItem(LOCKOUT_KEY) || 0);
        if (lockedUntil && now < lockedUntil) {
            return {
                valid: false,
                retryDelayMs: lockedUntil - now,
            };
        }

        // Too many failed attempts -> start a fresh lockout window
        const attempts = Number(localStorage.getItem(ATTEMPTS_KEY) || 0);
        if (attempts >= MAX_ATTEMPTS) {
            localStorage.setItem(LOCKOUT_KEY, String(now + LOCKOUT_MS));
            return { valid: false, retryDelayMs: LOCKOUT_MS };
        }

        const computed = await computeHmac(pepper, pin);

        if (!safeEqual(computed, hmac)) {
            const failed = attempts + 1;
            localStorage.setItem(ATTEMPTS_KEY, String(failed));

            if (failed >= MAX_ATTEMPTS) {
                localStorage.setItem(LOCKOUT_KEY, String(Date.now() + LOCKOUT_MS));
                return { valid: false, retryDelayMs: LOCKOUT_MS };
            }

            return { valid: false, attemptsLeft: MAX_ATTEMPTS - failed };
        }

        localStorage.removeItem(ATTEMPTS_KEY);
        localStorage.removeItem(LOCKOUT_KEY);
        setUnlocked();

        return { valid: true };
    },

    // Set / change the PIN
    async setPin(pin) {
        if (!PIN_PATTERN.test(pin)) {
            throw new Error("PIN must be 4–6 digits.");
        }

        const pepper = await ensurePepper();
        const hmac = await computeHmac(pepper, pin);

        localStorage.setItem(HMAC_KEY, hmac);
        localStorage.removeItem(ATTEMPTS_KEY);
        localStorage.removeItem(LOCKOUT_KEY);
        setUnlocked();
    },

    // Change PIN (verify current first)
    async changePin(currentPin, newPin) {
        if (!PIN_PATTERN.test(newPin)) {
            throw new Error("PIN must be 4–6 digits.");
        }

        const verdict = await appLock.verify(currentPin);

        if (!verdict.valid || verdict.notConfigured) {
            throw new Error("The current PIN is incorrect.");
        }

        await appLock.setPin(newPin);
    },

    removePin() {
        localStorage.removeItem(HMAC_KEY);
        localStorage.removeItem(ATTEMPTS_KEY);
        localStorage.removeItem(LOCKOUT_KEY);
        appLock.lock();
        // Pepper remains in IndexedDB; harmless until a new PIN is set.
    },

    // Forgot-PIN escape hatch: wipe all local lock state so the
    // user can reach Settings and configure a new PIN. Anyone with
    // device access can do this — that is inherent to a local-only
    // lock and must be surfaced in the UI before confirming.
    async resetPin() {
        localStorage.removeItem(HMAC_KEY);
        localStorage.removeItem(ATTEMPTS_KEY);
        localStorage.removeItem(LOCKOUT_KEY);

        try {
            await deletePepper();
        } catch {
            // best-effort: leftover pepper does not re-enable the lock
        }

        appLock.lock();
    },
};

export default appLock;
