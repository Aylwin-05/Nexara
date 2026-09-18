// ==========================================================
// IndexedDB-backed Session Store for SignalSessionManager
//
// Implements the SessionStore interface from session.js
// (get / save / delete keyed by our device, remote device,
// conversation) on top of the IndexedDB key store.
// Ratchet states are stored as their toDict() JSON form.
// ==========================================================

import { signalKeyStore } from "./keyStore.js";
import { RatchetState } from "./doubleRatchet.js";

export class IndexedDbSessionStore {
    constructor(keyStore = signalKeyStore) {
        this.keyStore = keyStore;
    }

    async get(ourDeviceId, remoteDeviceId, conversationId) {
        const state = await this.keyStore.getSession({
            ourDeviceId,
            remoteDeviceId,
            conversationId,
        });
        if (!state) return null;
        return RatchetState.fromDict(state);
    }

    async save(ourDeviceId, remoteDeviceId, conversationId, state) {
        await this.keyStore.saveSession(
            { ourDeviceId, remoteDeviceId, conversationId },
            state.toDict(),
        );
    }

    async delete(ourDeviceId, remoteDeviceId, conversationId) {
        await this.keyStore.deleteSession({
            ourDeviceId,
            remoteDeviceId,
            conversationId,
        });
    }
}