// ==========================================================
// Nexara Signal Chat Service
//
// High-level wrapper used by the chat UI:
//   - encrypt():  fetch peer bundle (once), run X3DH first
//                 message or use the established ratchet session
//   - decrypt():  parse an incoming envelope JSON and decrypt
//                 via the local device's session
//
// Multi-device:
//   - encryptForDevices(): one envelope PER device of both
//                 users (sender's other devices included), so
//                 every browser of an account can decrypt.
//   - encryptBytesForDevices(): same, but payload is raw bytes
//                 (used to wrap group AES keys per device).
//
// Envelope JSON is carried in the message "ciphertext" field of
// the existing REST/WS message schema (legacy RSA fields get
// placeholder values), keeping the backend API unchanged.
// ==========================================================

import { signalKeyStore } from "../crypto/signal/keyStore.js";
import { IndexedDbSessionStore } from "../crypto/signal/sessionStore.js";
import { SignalSessionManager } from "../crypto/signal/session.js";
import { SignalEnvelope } from "../crypto/signal/message.js";
import { b64decode } from "../crypto/signal/bytes.js";

export class SignalChatError extends Error {}

const PEER_MAP_ID = "peer-map";
const PIN_MAP_ID = "identity-pins";

// ==========================================================
// Identity key pinning (TOFU)
//
// The server could serve a swapped identity key for a peer's
// device (compromised server / MITM). Every bundle we fetch is
// therefore checked against the identity keys we pinned the
// FIRST time we saw that device; a changed key aborts the
// session instead of silently encrypting to the attacker.
// Pins live in the local key store and are wiped on logout.
// ==========================================================

async function verifyAndPinDevices({ keyStore, devices }) {
    if (!devices?.length) return;

    const pins = (await keyStore.peekMeta(PIN_MAP_ID)) ?? { devices: {} };
    let changed = false;

    for (const device of devices) {
        const deviceId = device.device_id;
        const served = device.identity_key;
        if (!deviceId || !served) continue;

        const pinned = pins.devices[deviceId];

        if (pinned !== undefined && pinned !== served) {
            throw new SignalChatError(
                `Identity key changed for device "${deviceId}" — ` +
                "possible interception. Wipe local data and verify " +
                "the contact out of band before continuing.",
            );
        }

        if (pinned === undefined) {
            pins.devices[deviceId] = served;
            changed = true;
        }
    }

    if (changed) {
        await keyStore.saveMeta({ id: PIN_MAP_ID, ...pins });
    }
}

// ==========================================================
// Session manager bound to the local device
// ==========================================================

export async function getSignalSessionManager(keyStore = signalKeyStore) {
    const identity = await keyStore.getIdentity();
    if (!identity) {
        throw new SignalChatError(
            "No Signal identity registered; re-login first.",
        );
    }
    return {
        manager: new SignalSessionManager(new IndexedDbSessionStore(keyStore)),
        identity,
        keyStore,
    };
}

// ==========================================================
// Local device
// ==========================================================

async function localDevice(keyStore) {
    const meta = await keyStore.getMeta();
    if (!meta?.deviceId) {
        throw new SignalChatError("Signal device not registered.");
    }
    return meta;
}

// ==========================================================
// Resolve which remote device a conversation maps to
// (first message picks devices[0]; afterwards it is pinned)
// ==========================================================

async function resolveRemoteDevice(
    keyStore,
    conversationId,
    remoteDevices,
) {
    const peers = (await keyStore.peekMeta(PEER_MAP_ID)) ?? {
        conversations: {},
    };

    let remoteDeviceId = peers.conversations[conversationId];

    if (remoteDeviceId) {

        // No fresh bundle means "use the pinned device" (session
        // continuation) — honour the pin. With a bundle, verify the
        // pin still exists: the peer may have wiped/re-registered
        // its device, so drop the pin and pick the current one.
        const stillExists =
            !remoteDevices ||
            remoteDevices.some(
                (d) => d.device_id === remoteDeviceId,
            );

        if (stillExists) return remoteDeviceId;

        delete peers.conversations[conversationId];
        await keyStore.saveMeta({ id: PEER_MAP_ID, ...peers });

    }

    if (!remoteDevices?.length) {
        throw new SignalChatError("Peer has no registered devices.");
    }
    remoteDeviceId = remoteDevices[0].device_id;

    peers.conversations[conversationId] = remoteDeviceId;
    await keyStore.saveMeta({ id: PEER_MAP_ID, ...peers });
    return remoteDeviceId;
}

// ==========================================================
// Encrypt a plaintext for a conversation
//
// Pass remoteDevices (list from deviceService.getBundle) or a
// bundleProvider() that returns it; the first device is pinned
// for the conversation.
// ==========================================================

export async function encryptForConversation({
    conversationId,
    otherUserId = null,
    plaintext,
    remoteDevices = null,
    bundleProvider = null,
    keyStore = signalKeyStore,
}) {
    const { manager, identity } = await getSignalSessionManager(keyStore);
    const our = await localDevice(keyStore);

    if (!remoteDevices && bundleProvider) {
        remoteDevices = await bundleProvider();
    }

    // getBundle returns the API bundle object
    // `{ user_id, devices: [...] }` — normalize to the array.
    // Keep `null` when no bundle was provided so the pinned
    // device path (session continuation) still works.
    const deviceList = remoteDevices == null
        ? null
        : (Array.isArray(remoteDevices)
            ? remoteDevices
            : (remoteDevices.devices ?? []));

    if (deviceList) {
        await verifyAndPinDevices({ keyStore, devices: deviceList });
    }

    const remoteDeviceId = await resolveRemoteDevice(
        keyStore,
        conversationId,
        deviceList,
    );

    const session = await manager.store.get(
        our.deviceId,
        remoteDeviceId,
        conversationId,
    );

    let envelope;
    if (session) {
        envelope = await manager.encrypt({
            ourDeviceId: our.deviceId,
            ourUserId: our.deviceId,
            remoteDeviceId,
            conversationId,
            plaintext: utf8Bytes(plaintext),
        });
    } else {
        const device = deviceList.find(
            (d) => d.device_id === remoteDeviceId,
        );
        if (!device) {
            throw new SignalChatError("Peer device bundle unavailable.");
        }
        envelope = await manager.encryptFirst({
            ourDeviceId: our.deviceId,
            ourUserId: our.deviceId,
            ourIdentityPrivate: b64decode(identity.identityKeyPrivate),
            theirDeviceId: remoteDeviceId,
            theirBundle: device,
            conversationId,
            plaintext: utf8Bytes(plaintext),
        });
    }

    return {
        ciphertext: envelope.toJson(),
        type: envelope.type,
        deviceId: envelope.deviceId,
    };
}

// ==========================================================
// Encrypt a payload (raw bytes) for a LIST of devices
//
// Each target device gets its own envelope: the existing
// ratchet session when there is one, otherwise a fresh X3DH
// handshake against that device's bundle. Our own current
// device is skipped (own sends are read from the plaintext
// cache, and a (me, me) session does not exist).
// ==========================================================

export async function encryptBytesForDevices({
    conversationId,
    bytes,
    devices,
    keyStore = signalKeyStore,
}) {
    const { manager, identity } = await getSignalSessionManager(keyStore);
    const our = await localDevice(keyStore);

    await verifyAndPinDevices({ keyStore, devices });

    const envelopes = [];

    for (const device of devices) {

        if (!device?.device_id) continue;

        // Never encrypt to ourselves: no (me, me) ratchet.
        if (device.device_id === our.deviceId) continue;

        const session = await manager.store.get(
            our.deviceId,
            device.device_id,
            conversationId,
        );

        let envelope;

        if (session) {

            envelope = await manager.encrypt({
                ourDeviceId: our.deviceId,
                ourUserId: our.deviceId,
                remoteDeviceId: device.device_id,
                conversationId,
                plaintext: bytes,
            });

        }
        else {

            envelope = await manager.encryptFirst({
                ourDeviceId: our.deviceId,
                ourUserId: our.deviceId,
                ourIdentityPrivate: b64decode(identity.identityKeyPrivate),
                theirDeviceId: device.device_id,
                theirBundle: device,
                conversationId,
                plaintext: bytes,
            });

        }

        envelopes.push({
            device_id: device.device_id,
            data: envelope.toJson(),
        });

    }

    return envelopes;

}

// ==========================================================
// Encrypt a plaintext for EVERY device of both users
//
// devices: list of bundle entries — peer devices first, then
// our own devices. Returns:
//   - envelopes: one envelope per reachable device
//   - ciphertext: the envelope for the conversation's pinned
//     device (legacy field; keeps old clients / search working)
// ==========================================================

export async function encryptForDevices({
    conversationId,
    plaintext,
    devices,
    keyStore = signalKeyStore,
}) {

    const envelopes = await encryptBytesForDevices({
        conversationId,
        bytes: utf8Bytes(plaintext),
        devices,
        keyStore,
    });

    if (!envelopes.length) {
        throw new SignalChatError("No reachable peer devices.");
    }

    // Legacy ciphertext: the envelope for the pinned remote
    // device (first message picks devices[0]; afterwards it is
    // pinned in the peer map, exactly like the single-envelope
    // path used to do).
    const deviceList = devices;
    const pinned = await resolveRemoteDevice(
        keyStore,
        conversationId,
        deviceList,
    );

    const pinnedEnvelope = envelopes.find(
        (entry) => entry.device_id === pinned,
    );

    return {
        ciphertext: pinnedEnvelope?.data ?? envelopes[0].data,
        envelopes,
    };

}

// ==========================================================
// Decrypt an incoming envelope JSON -> raw bytes
//
// Shared by DM decryption (payload = plaintext) and group
// decryption (payload = the wrapped AES key).
// ==========================================================

export async function decryptEnvelopeBytes({
    conversationId,
    envelopeJson,
    keyStore = signalKeyStore,
}) {
    const { manager, identity } = await getSignalSessionManager(keyStore);
    const our = await localDevice(keyStore);

    let envelope;
    try {
        envelope = SignalEnvelope.fromJson(envelopeJson);
    } catch {
        throw new SignalChatError("Not a Signal envelope.");
    }

    if (envelope.type === "data") {

        const result = await manager.decrypt({
            envelope,
            ourDeviceId: our.deviceId,
            conversationId,
        });

        return result.plaintext;

    }

    if (envelope.type === "prekey") {

        // The sender's identity arrives inside the handshake:
        // enforce TOFU pinning here too (the sender's bundle may
        // have been seen before with a DIFFERENT identity key).
        const pins = (await keyStore.peekMeta(PIN_MAP_ID)) ?? { devices: {} };
        const pinned = pins.devices[envelope.deviceId];
        const served = envelope.x3dhInfo?.identity_key ?? null;
        if (pinned !== undefined && served !== null && pinned !== served) {
            throw new SignalChatError(
                `Identity key changed for device "${envelope.deviceId}" — ` +
                "possible interception.",
            );
        }

        const spkId = envelope.x3dhInfo?.signed_prekey_id ?? null;
        const spk = spkId != null ? await keyStore.getSignedPrekey(spkId) : null;
        if (!spk) {
            throw new SignalChatError("Signed prekey not found for handshake.");
        }

        let oneTime = null;
        const opkId = envelope.x3dhInfo?.one_time_prekey_id ?? null;
        if (opkId != null) {
            oneTime = await keyStore.getOneTimePrekey(opkId);
            if (!oneTime) {
                throw new SignalChatError("One-time prekey not found.");
            }
        }

        const result = await manager.decryptFirst({
            envelope,
            ourDeviceId: our.deviceId,
            ourIdentityKey: b64decode(identity.identityKeyPrivate),
            signedPrekey: { key_id: spk.keyId, private_key: spk.privateKey },
            oneTimePrekey: oneTime
                ? { key_id: oneTime.keyId, private_key: oneTime.privateKey }
                : null,
            conversationId,
        });

        // One-time prekeys are single-use: purge locally
        if (oneTime) {
            await keyStore.removeOneTimePrekey(opkId);
        }

        return result.plaintext;

    }

    throw new SignalChatError(`Unknown envelope type: ${envelope.type}`);
}

// ==========================================================
// Decrypt an incoming message envelope (DM path)
// ==========================================================

export async function decryptMessage({
    conversationId,
    ciphertext,
    keyStore = signalKeyStore,
}) {
    const plaintextBytes = await decryptEnvelopeBytes({
        conversationId,
        envelopeJson: ciphertext,
        keyStore,
    });
    return utf8DecodeBytes(plaintextBytes);
}

// ==========================================================
// Helpers
// ==========================================================

function utf8Bytes(text) {
    return new TextEncoder().encode(text);
}

function utf8DecodeBytes(bytes) {
    return new TextDecoder().decode(bytes);
}