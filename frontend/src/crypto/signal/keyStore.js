// ==========================================================
// Nexara Signal Key Store (IndexedDB)
//
// Persists the device's Signal identity material, one-time
// prekeys and ratchet session states in a browser IndexedDB.
//
//   - "identity":         Ed25519 keys + derived X25519 identity
//   - "signed_prekey":    current signed prekey (client-owned)
//   - "one_time_prekeys": local pool of OPK privates
//   - "sessions":         double-ratchet session states
//   - "meta":             device info / storage secrets
//   - "plaintext_cache":  locally readable plaintext of sent AND
//                         received messages that could NEVER be
//                         re-decrypted after a page reload (the
//                         sender lacks a (me, me) ratchet, the
//                         receiver's first handshake prekey is
//                         consumed and deleted).
//
// All sensitive values persist in the browser's IndexedDB. The
// plaintext cache (see below) is deliberately unencrypted.
// ==========================================================

import { logger } from "../../utils/logger.js";

const DB_NAME = "nexara-signal";
const DB_VERSION = 5;

const STORE_IDENTITY = "identity";
const STORE_SIGNED_PREKEY = "signed_prekey";
const STORE_ONE_TIME_PREKEYS = "one_time_prekeys";
const STORE_SESSIONS = "sessions";
const STORE_META = "meta";
const STORE_PLAINTEXT_CACHE = "plaintext_cache";
const STORE_SENT_TEXT = "sent_text"; // legacy name (<= v2)

// Every store this app needs. Created idempotently so any
// partially-upgraded database heals back to the full schema.
const STORE_DEFS = [
    { name: STORE_SIGNED_PREKEY, keyPath: "keyId" },
    { name: STORE_ONE_TIME_PREKEYS, keyPath: "keyId" },
    { name: STORE_SESSIONS, keyPath: "id" },
    { name: STORE_IDENTITY, keyPath: "id" },
    { name: STORE_META, keyPath: "id" },
    { name: STORE_PLAINTEXT_CACHE, keyPath: "id" },
];

function upgradeSchema(request) {
    const db = request.result;

    for (const spec of STORE_DEFS) {
        if (!db.objectStoreNames.contains(spec.name)) {
            db.createObjectStore(spec.name, { keyPath: spec.keyPath });
        }
    }

    // Legacy "sent_text" holds the same records under the same
    // key scheme, so copying (id-keyed put = overwrite with the
    // identical record) and dropping it is safe to run whenever
    // the old store turns up, even twice.
    if (db.objectStoreNames.contains(STORE_SENT_TEXT)) {
        const t = request.transaction;
        const read = t.objectStore(STORE_SENT_TEXT).getAll();
        read.onsuccess = () => {
            const target = t.objectStore(STORE_PLAINTEXT_CACHE);
            for (const record of read.result) {
                target.put(record);
            }
        };
        db.deleteObjectStore(STORE_SENT_TEXT);
    }
}

function openDb(dbName, version) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, version);
        request.onupgradeneeded = () => upgradeSchema(request);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function tx(db, storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
}

function promisify(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ==========================================================
// Low-level store operations
// ==========================================================

function _put(db, storeName, record) {
    return promisify(tx(db, storeName, "readwrite").put(record));
}

function _get(db, storeName, key) {
    return promisify(tx(db, storeName, "readonly").get(key)).then(
        (record) => record ?? null,
    );
}

function _getAll(db, storeName) {
    return promisify(tx(db, storeName, "readonly").getAll());
}

function _delete(db, storeName, key) {
    return promisify(tx(db, storeName, "readwrite").delete(key));
}

function _clear(db, storeName) {
    return promisify(tx(db, storeName, "readwrite").clear());
}

// ==========================================================
// Key Store
// ==========================================================

export class SignalKeyStore {
    constructor(dbName = DB_NAME) {
        this._dbName = dbName;
        this._dbPromise = null;
    }

    async _db() {
        if (!this._dbPromise) {
            this._dbPromise = this._open();
        }
        return this._dbPromise;
    }

    async _open() {
        let db = await openDb(this._dbName, DB_VERSION);

        // Self-heal: if a store is missing (a partial upgrade can
        // commit a version whose schema never materialised), drop
        // the connection and reopen at one version higher so the
        // upgrade handler re-runs and fills in the gaps.
        if (!STORE_DEFS.every(spec =>
            db.objectStoreNames.contains(spec.name)
        )) {
            logger.warn(
                "Signal store schema incomplete — repairing",
                [...db.objectStoreNames],
            );
            db.close();
            db = await openDb(this._dbName, DB_VERSION + 1);
        }

        return db;
    }

    // ------------------------------------------------------
    // Meta (device record) - not fully encrypted (device info public)
    // ------------------------------------------------------

    async saveMeta(meta) {
        const db = await this._db();
        await promisify(tx(db, STORE_META, "readwrite").put({
            id: meta.id ?? "device",
            ...meta,
        }));
    }

    async getMeta() {
        const db = await this._db();
        const record = await promisify(tx(db, STORE_META, "readonly").get("device"));
        return record ?? null;
    }

    async peekMeta(id) {
        const db = await this._db();
        const record = await promisify(tx(db, STORE_META, "readonly").get(id));
        return record ?? null;
    }

    async clearMeta() {
        const db = await this._db();
        await promisify(tx(db, STORE_META, "readwrite").delete("device"));
    }

    // ------------------------------------------------------
    // Account sync secret (cross-browser history)
    //
    // A separate meta record ("sync"): the 32-byte account
    // secret that encrypts every message/attachment sync copy.
    // Saved after unlocking with the recovery code. The owning
    // account email rides along so a different account logging
    // in on the same browser can't inherit (or be blinded by)
    // a stale secret. Logout preserves the record; the device
    // key material is what gets wiped.
    // ------------------------------------------------------

    async saveSyncSecret(secretB64, email = null) {
        const db = await this._db();
        await promisify(tx(db, STORE_META, "readwrite").put({
            id: "sync",
            secret: secretB64,
            email: email ?? null,
        }));
    }

    async getSyncSecret() {
        const record = await this.peekMeta("sync");
        return record?.secret ?? null;
    }

    async getSyncRecord() {
        return this.peekMeta("sync");
    }

    async clearSyncRecord() {
        const db = await this._db();
        await promisify(tx(db, STORE_META, "readwrite").delete("sync"));
    }

    // ------------------------------------------------------
    // Identity keys
    // ------------------------------------------------------

    async saveIdentity(identity) {
        const db = await this._db();
        await _put(db, STORE_IDENTITY, {
            id: "device",
            deviceId: identity.deviceId,
            identityKeyPrivate: identity.identityKeyPrivate,       // b64 Ed25519 priv
            identityKeyPublic: identity.identityKeyPublic,       // b64 Ed25519 pub
            x25519IdentityKeyPublic: identity.x25519IdentityKeyPublic, // b64 X25519 pub
            createdAt: Date.now(),
        });
    }

    async getIdentity() {
        const db = await this._db();
        return _get(db, STORE_IDENTITY, "device");
    }

    // ------------------------------------------------------
    // Signed prekey (only the latest is kept)
    // ------------------------------------------------------

    async saveSignedPrekey(spk) {
        const db = await this._db();
        await _put(db, STORE_SIGNED_PREKEY, {
            keyId: spk.keyId,
            publicKey: spk.publicKey,       // b64
            signature: spk.signature,       // b64
            privateKey: spk.privateKey,     // b64
        });
    }

    async getAllSignedPrekeys() {
        const db = await this._db();
        return _getAll(db, STORE_SIGNED_PREKEY);
    }

    async getSignedPrekey(keyId) {
        const db = await this._db();
        return _get(db, STORE_SIGNED_PREKEY, keyId);
    }

    async clearSignedPrekeys() {
        const db = await this._db();
        await _clear(db, STORE_SIGNED_PREKEY);
    }

    // ------------------------------------------------------
    // One-time prekeys (local private pool)
    // ------------------------------------------------------

    async saveOneTimePrekeys(opks) {
        const db = await this._db();
        for (const opk of opks) {
            await _put(db, STORE_ONE_TIME_PREKEYS, {
                keyId: opk.keyId,
                publicKey: opk.publicKey,
                privateKey: opk.privateKey,
            });
        }
    }

    async getAllOneTimePrekeys() {
        const db = await this._db();
        return _getAll(db, STORE_ONE_TIME_PREKEYS);
    }

    async getOneTimePrekey(keyId) {
        const db = await this._db();
        return _get(db, STORE_ONE_TIME_PREKEYS, keyId);
    }

    async getOneTimePrekeyCount() {
        const db = await this._db();
        const count = await promisify(
            tx(db, STORE_ONE_TIME_PREKEYS, "readonly").count(),
        );
        return count;
    }

    async removeOneTimePrekey(keyId) {
        const db = await this._db();
        await _delete(db, STORE_ONE_TIME_PREKEYS, keyId);
    }

    async clearOneTimePrekeys() {
        const db = await this._db();
        await _clear(db, STORE_ONE_TIME_PREKEYS);
    }

    // ------------------------------------------------------
    // Double-ratchet sessions (keyed by conversation/devices)
    // ------------------------------------------------------

    async saveSession({ ourDeviceId, remoteDeviceId, conversationId }, state) {
        const db = await this._db();
        await _put(db, STORE_SESSIONS, {
            id: sessionId(ourDeviceId, remoteDeviceId, conversationId),
            ourDeviceId,
            remoteDeviceId,
            conversationId,
            state,
        });
    }

    async getSession({ ourDeviceId, remoteDeviceId, conversationId }) {
        const db = await this._db();
        const record = await _get(db, STORE_SESSIONS, sessionId(ourDeviceId, remoteDeviceId, conversationId));
        return record ? record.state : null;
    }

    async deleteSession({ ourDeviceId, remoteDeviceId, conversationId }) {
        const db = await this._db();
        await _delete(db, STORE_SESSIONS, sessionId(ourDeviceId, remoteDeviceId, conversationId));
    }

    // ------------------------------------------------------
    // Plaintext cache (sent AND received)
    //
    // Double-ratchet messages are not internally replayable:
    //  - own sent envelopes: the session is keyed (myDevice,
    //    theirDevice), never (me, me) — cannot re-decrypt.
    //  - the first received envelope decrypts against a one-time
    //    prekey that is consumed and DELETED on first use — the
    //    handshake message itself can never be decrypted again.
    // To let history survive a page reload we cache what the
    // user has actually seen/typed, keyed per message id.
    // ------------------------------------------------------

    async savePlaintext(
        conversationId,
        messageId,
        plaintext,
        ciphertext = null,
    ) {
        const db = await this._db();
        await _put(db, STORE_PLAINTEXT_CACHE, {
            id: `${conversationId}:${messageId}`,
            conversationId,
            messageId,
            plaintext,
            ciphertext,
        });
    }

    async getCachedRecord(
        conversationId,
        messageId,
    ) {
        const db = await this._db();
        return _get(db, STORE_PLAINTEXT_CACHE, `${conversationId}:${messageId}`);
    }

    async getAllCachedRecords() {
        const db = await this._db();
        return _getAll(db, STORE_PLAINTEXT_CACHE);
    }

    // ------------------------------------------------------
    // Wipe everything (logout / re-registration)
    // ------------------------------------------------------

    async clearAll() {
        const db = await this._db();
        const stores = [
            STORE_IDENTITY,
            STORE_ONE_TIME_PREKEYS,
            STORE_SESSIONS,
            STORE_SIGNED_PREKEY,
            STORE_META,
            STORE_PLAINTEXT_CACHE,
        ];
        const t = db.transaction(stores, "readwrite");
        await Promise.all(
            stores.map((name) => promisify(t.objectStore(name).clear())),
        );
    }

    // ------------------------------------------------------
    // Wipe ONLY this device's key material
    //
    // Used when the server no longer knows our registered
    // device (e.g. the DB was reset, or the device was revoked
    // from another browser). Clears the identity, prekeys,
    // sessions and the meta device record so a fresh
    // registration is forced — WITHOUT destroying the account
    // sync secret or the plaintext cache, both of which must
    // survive re-registration.
    // ------------------------------------------------------

    async clearDeviceMaterial() {
        const db = await this._db();
        const stores = [
            STORE_IDENTITY,
            STORE_SIGNED_PREKEY,
            STORE_ONE_TIME_PREKEYS,
            STORE_SESSIONS,
        ];
        const t = db.transaction(stores, "readwrite");
        await Promise.all(
            stores.map((name) => promisify(t.objectStore(name).clear())),
        );
        await this.clearMeta();
    }
}

function sessionId(ourDeviceId, remoteDeviceId, conversationId) {
    return `${ourDeviceId}|${remoteDeviceId}|${conversationId}`;
}

// Singleton used across the app
export const signalKeyStore = new SignalKeyStore();