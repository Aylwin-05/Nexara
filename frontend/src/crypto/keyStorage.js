// ==========================================================
// Nexara Key Storage
//
// Account RSA keypair persistence.
//
// Production:
// IndexedDB ("nexara-keys"). Keys are never written to
// localStorage.
//
// Migration:
// Browsers that still hold the legacy localStorage copies
// ("nexara_public_key" / "nexara_private_key") get
// them lifted into IndexedDB on first DB open, after which
// the localStorage entries are removed.
// ==========================================================

const DB_NAME = "nexara-keys";
const DB_VERSION = 1;
const STORE = "keys";

const PUBLIC_KEY = "nexara_public_key";
const PRIVATE_KEY = "nexara_private_key";

let dbPromise = null;

// ==========================================================
// IndexedDB plumbing
// ==========================================================

function openDb() {

    return new Promise((resolve, reject) => {

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {

            const db = request.result;

            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }

        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);

    });

}

async function ensureDb() {

    if (!dbPromise) {

        dbPromise = openDb().then(async (db) => {

            await migrateLegacyLocalStorage(db);
            return db;

        });

    }

    return dbPromise;

}

function idbGet(db, key) {

    return new Promise((resolve, reject) => {

        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);

        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);

    });

}

function idbSet(db, key, value) {

    return new Promise((resolve, reject) => {

        const tx = db.transaction(STORE, "readwrite");
        const req = tx.objectStore(STORE).put(value, key);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);

    });

}

function idbDelete(db, key) {

    return new Promise((resolve, reject) => {

        const tx = db.transaction(STORE, "readwrite");
        const req = tx.objectStore(STORE).delete(key);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);

    });

}

// ==========================================================
// Legacy migration (one-time lift out of localStorage)
// ==========================================================

async function migrateLegacyLocalStorage(db) {

    if (typeof localStorage === "undefined") {
        return;
    }

    let legacyPublicKey = null;
    let legacyPrivateKey = null;

    try {
        legacyPublicKey = localStorage.getItem(PUBLIC_KEY);
        legacyPrivateKey = localStorage.getItem(PRIVATE_KEY);
    } catch {
        return;
    }

    if (!legacyPublicKey && !legacyPrivateKey) {
        return;
    }

    if (legacyPublicKey && !(await idbGet(db, PUBLIC_KEY))) {
        await idbSet(db, PUBLIC_KEY, legacyPublicKey);
    }

    if (legacyPrivateKey && !(await idbGet(db, PRIVATE_KEY))) {
        await idbSet(db, PRIVATE_KEY, legacyPrivateKey);
    }

    // LocalStorage copies are removed once migrated.
    try {
        localStorage.removeItem(PUBLIC_KEY);
        localStorage.removeItem(PRIVATE_KEY);
    } catch {
        // ignore
    }

}

// ==========================================================
// Public API
// ==========================================================

export async function getPublicKey() {

    const db = await ensureDb();
    return idbGet(db, PUBLIC_KEY);

}

export async function getPrivateKey() {

    const db = await ensureDb();
    return idbGet(db, PRIVATE_KEY);

}

export async function saveKeyPair(publicKey, privateKey) {

    const db = await ensureDb();
    await idbSet(db, PUBLIC_KEY, publicKey);
    await idbSet(db, PRIVATE_KEY, privateKey);

}

export async function hasKeyPair() {

    const db = await ensureDb();

    return !!(
        (await idbGet(db, PUBLIC_KEY))
        &&
        (await idbGet(db, PRIVATE_KEY))
    );

}

export async function clearKeyPair() {

    const db = await ensureDb();
    await idbDelete(db, PUBLIC_KEY);
    await idbDelete(db, PRIVATE_KEY);

    // Also scrub any pre-migration leftovers.
    try {
        localStorage.removeItem(PUBLIC_KEY);
        localStorage.removeItem(PRIVATE_KEY);
    } catch {
        // ignore
    }

}
