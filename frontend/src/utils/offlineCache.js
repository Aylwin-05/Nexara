const DB_NAME = "nexara-offline";
const DB_VERSION = 1;
const STORE_QUEUE = "outbox";

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ==========================================================
// Offline outbox queue (messages sent while offline)
// ==========================================================

export async function enqueueMessage(payload) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_QUEUE, "readwrite");
        tx.objectStore(STORE_QUEUE).add({
            ...payload,
            queued_at: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function dequeueMessages() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_QUEUE, "readwrite");
        const store = tx.objectStore(STORE_QUEUE);
        const req = store.getAll();
        req.onsuccess = () => {
            const items = req.result;
            store.clear();
            resolve(items);
        };
        tx.onerror = () => reject(tx.error);
    });
}