// ==========================================================
// Nexara Signal Device Service (frontend)
//
// Orchestrates first-run device registration:
//   1. generate Ed25519 identity + signed prekey + OPK batch
//   2. persist private material in the local IndexedDB store
//   3. POST /devices/register with the public payload
//   4. remember the device id / primary flag in the key store
// ==========================================================

import deviceService from "./deviceService";
import recoveryService from "./recoveryService";
import { signalKeyStore } from "../crypto/signal/keyStore";
import { replenishOneTimePrekeys } from "../crypto/signal/prekeyManager";
import { clearKeyPair } from "../crypto/keyStorage";
import { b64encode, b64decode } from "../crypto/signal/bytes";
import { nativePlatform } from "../utils/platform.js";
import {
    buildRegisterPayload,
    generateDeviceId,
    generateDeviceIdentity,
    generateOneTimePrekeys,
    generateSignedPrekey,
} from "../crypto/signal/identity";

// The server refuses to serve a signed prekey once it has hit
// its 30-day TTL (SIGNED_PREKEY_TTL_DAYS). Any device that has
// not rotated in that window becomes unreachable for X3DH —
// the every-boot check below keeps ours fresh.
const ROTATE_SPK_AFTER_MS = 25 * 24 * 60 * 60 * 1000;

// ==========================================================
// First-run device registration is NOT idempotent by itself:
// concurrent callers (login() + the AuthProvider boot effect,
// both doubled by React StrictMode) can each pass the "no meta
// yet" check and register a DIFFERENT device — leaving orphaned
// device rows on the server whose envelopes nothing decrypts.
//
// Guard with a shared in-flight promise (same-tab) and, when
// available, the Web Locks API (cross-tab). Every caller after
// the first awaits the SAME registration.
// ==========================================================

let registrationPromise = null;

// Err on the side of keeping the local device: only report
// "gone" when the server positively confirms it does NOT list
// the device. A transient network/HTTP failure must never
// trigger a data-wiping re-registration mid-flight.
async function deviceExistsOnServer(deviceId) {

    try {

        const { devices = [] } =
            await deviceService.listDevices();

        return devices.some(
            (device) =>
                String(device.device_id) ===
                String(deviceId)
        );

    }
    catch {

        return true;

    }

}

function withDeviceLock(fn) {

    if (navigator?.locks?.request) {

        return navigator.locks.request(
            "nexara-device-register",
            fn,
        );

    }

    return fn();

}

// The signed prekey is replaced while the Ed25519 identity
// stays fixed (the server's rotate endpoint expires any older
// key_id). Nothing here is fallible enough to block boot, so
// caller wraps it in try/catch.
async function rotateSignedPrekeyIfDue() {

    const [meta, identity] = await Promise.all([
        signalKeyStore.getMeta(),
        signalKeyStore.getIdentity(),
    ]);

    const issuedAt = meta?.spkIssuedAt ?? 0;

    if (
        issuedAt > 0 &&
        Date.now() - issuedAt < ROTATE_SPK_AFTER_MS
    ) {

        return false;

    }

    const spks = await signalKeyStore.getAllSignedPrekeys();

    const latest = spks
        ? [...spks].sort(
            (a, b) => (a.keyId ?? 0) - (b.keyId ?? 0)
        ).at(-1)
        : null;

    if (!latest?.keyId || !identity?.identityKeyPrivate) {

        // Nothing to rotate against; the fresh-registration path
        // will produce a full key set.
        return false;

    }

    const spk = generateSignedPrekey({
        identityPrivateKey: b64decode(
            identity.identityKeyPrivate,
        ),
        keyId: latest.keyId + 1,
    });

    await signalKeyStore.saveSignedPrekey({
        keyId: spk.keyId,
        publicKey: b64encode(spk.publicKey),
        signature: b64encode(spk.signature),
        privateKey: b64encode(spk.privateKey),
    });

    await deviceService.rotateSignedPrekey({
        device_id: meta.deviceId,
        key_id: spk.keyId,
        public_key: b64encode(spk.publicKey),
        signature: b64encode(spk.signature),
    });

    await signalKeyStore.saveMeta({
        ...meta,
        spkIssuedAt: Date.now(),
    });

    return true;

}

export function ensureDeviceRegistered({
    platform = null,
    deviceName = null,
    platformVersion = null,
    appVersion = null,
    email = null,
} = {}) {

    // Report the real platform rather than always "web": this build
    // also ships inside the Capacitor Android shell, and a device
    // list that cannot tell a phone from a browser is useless.
    if (!platform) {
        platform = nativePlatform() ?? "web";
    }

    if (registrationPromise) {

        return registrationPromise;

    }

    registrationPromise = withDeviceLock(() =>

        (async () => {

            // Double-checked: the first caller may have completed
            // while we were waiting on the lock.
            const existing =
                await signalKeyStore.getMeta();

            if (existing?.deviceId) {

                // A persisted device is only trustworthy if the
                // server still knows about it. The dev DB (or a
                // remote account) may have been reset since this
                // browser last registered, leaving a stale
                // deviceId that makes the server 404 on every
                // key-bundle fetch and message send. Re-register
                // (after wiping this device's local key material)
                // when the server no longer lists the device.
                const stillKnown =
                    await deviceExistsOnServer(
                        existing.deviceId
                    );

                if (stillKnown) {

                    // Signed prekeys expire server-side after 30
                    // days. Rotate ours when it is old (or the
                    // age is unknown — legacy devices — which
                    // covers the very devices that have silently
                    // gone offline). Never let a rotation failure
                    // block the boot path.
                    try {

                        await rotateSignedPrekeyIfDue();

                    }
                    catch (error) {

                        console.error(
                            "Signed prekey rotation failed:",
                            error,
                        );

                    }

                    return {
                        deviceId: existing.deviceId,
                        isPrimary: existing.isPrimary,
                        generated: false,
                    };

                }

                // Server lost the device — clear stale key
                // material (keeping the sync secret) and fall
                // through to a fresh registration below.
                await signalKeyStore.clearDeviceMaterial();

            }

            const deviceId = generateDeviceId();

            const { identity, signedPrekey } = generateDeviceIdentity();
            const oneTimePrekeys = generateOneTimePrekeys();

            // Persist private material locally BEFORE uploading anything
            await signalKeyStore.saveIdentity({
                deviceId,
                identityKeyPrivate: b64encode(identity.privateKey),
                identityKeyPublic: b64encode(identity.publicKey),
                x25519IdentityKeyPublic: b64encode(identity.x25519Public),
            });
            await signalKeyStore.saveSignedPrekey({
                keyId: signedPrekey.keyId,
                publicKey: b64encode(signedPrekey.publicKey),
                signature: b64encode(signedPrekey.signature),
                privateKey: b64encode(signedPrekey.privateKey),
            });
            await signalKeyStore.saveOneTimePrekeys(
                oneTimePrekeys.map((opk) => ({
                    keyId: opk.keyId,
                    publicKey: b64encode(opk.publicKey),
                    privateKey: b64encode(opk.privateKey),
                })),
            );

            const payload = buildRegisterPayload({
                deviceId,
                platform,
                deviceName,
                platformVersion,
                appVersion,
                identity,
                signedPrekey,
                oneTimePrekeys,
            });

            const response = await deviceService.registerDevice(payload);
            const isPrimary = !!response.is_primary;

            await signalKeyStore.saveMeta({
                deviceId,
                isPrimary,
                platform,
                deviceName,
                spkIssuedAt: Date.now(),
            });

            // The account's recovery key was created by THIS
            // registration: unlock the sync secret right away and
            // surface the code so the UI can show it once.
            //
            // IMPORTANT: never overwrite an existing sync secret.
            // A second registration (e.g. after clearing data)
            // may return a FRESH recovery code that unwraps to a
            // DIFFERENT secret — saving it would break every
            // previously-written sync copy on the server.
            let recoveryCode = null;

            if (response.recovery_code) {

                const existingSecret =
                    await signalKeyStore.getSyncSecret();

                if (!existingSecret) {

                    try {

                        await recoveryService
                            .unlockFromRegistration({
                                code:
                                    response.recovery_code,
                                salt:
                                    response.recovery_salt,
                                wrapped_key:
                                    response.recovery_wrapped_key,
                                email,
                            });

                        recoveryCode =
                            response.recovery_code;

                    }
                    catch (error) {

                        console.error(
                            "Recovery auto-unlock failed:",
                            error
                        );

                    }

                }
                else {

                    recoveryCode =
                        response.recovery_code;

                }

            }

            return {
                deviceId,
                isPrimary,
                generated: true,
                recoveryCode,
            };

        })()

    );

    return registrationPromise.finally(() => {

        registrationPromise = null;

    });

}

// ==========================================================
// Current registered device
// ==========================================================

export async function getRegisteredDevice() {
    return signalKeyStore.getMeta();
}

// ==========================================================
// Replenish local one-time prekey pool (and mirror to server)
// ==========================================================

export async function replenishPreKeys(options = {}) {

    const meta = await signalKeyStore.getMeta();

    if (!meta?.deviceId) {

        return {

            replenished: 0,

            count: 0,

            uploaded: 0,

        };

    }

    return replenishOneTimePrekeys({

        keyStore: signalKeyStore,

        upload: (payload) => deviceService.uploadPreKeys({

            device_id: meta.deviceId,

            one_time_prekeys: payload,

        }),

        ...options,

    });

}

// ==========================================================
// Wipe the local device (logout / unlink)
//
// Best effort: remove the device from the server first (the
// primary device cannot be removed server-side), then always
// wipe every trace of key material from this browser.
//
// preserveSyncSecret: logout on the SAME browser keeps the
// account sync secret so the next login does not re-prompt
// for the recovery code — history stays unlocked locally.
// ==========================================================

export async function wipeDeviceData({
    removeFromServer = true,
    preserveSyncSecret = false,
} = {}) {

    const meta = await signalKeyStore.getMeta();

    const syncRecord = preserveSyncSecret
        ? await signalKeyStore.getSyncRecord()
        : null;

    if (removeFromServer && meta?.deviceId) {

        try {

            await deviceService.removeDevice(meta.deviceId);

        }

        catch {

            // Primary device cannot be removed; wiping locally
            // still decrypts nothing after this point.

        }

    }

    await signalKeyStore.clearAll();

    // The account RSA key pair must not survive logout — it
    // decrypts history and must not linger in any script-readable
    // storage once the session is gone.
    await clearKeyPair();

    if (syncRecord?.secret) {

        await signalKeyStore.saveSyncSecret(
            syncRecord.secret,
            syncRecord.email,
        );

    }

}
