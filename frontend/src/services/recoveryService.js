import api from "../api/api";
import {
    unwrapSyncSecret,
    clearSyncKeyCache,
} from "../crypto/syncCrypto";
import {
    signalKeyStore,
} from "../crypto/signal/keyStore";

// ==========================================================
// Account recovery code
//
// The recovery code is issued exactly once (shown on screen,
// never emailed) when the account's first recovery key is
// created.
// Logging in on a NEW browser can't read old history — the
// per-device envelopes for it never included this device — so
// the browser asks for the code, fetches the wrapped sync
// secret, unwraps it LOCALLY (PBKDF2 + AES-GCM, the server
// never sees the code or the secret) and can then decrypt the
// account-key sync copies of the whole history.
// ==========================================================

const recoveryService = {

    // ======================================================
    // Whether THIS browser already holds the sync secret
    // ======================================================

    async hasSyncSecret() {

        return Boolean(
            await signalKeyStore.getSyncSecret()
        );

    },

    // ======================================================
    // Unlock with the recovery code (new browser login)
    // ======================================================

    async unlock(code, email = null) {

        const response = await api.get(
            "/recovery/unlock"
        );

        const secret = unwrapSyncSecret(
            code,
            response.data.salt,
            response.data.wrapped_key,
        );

        if (!secret) {

            throw new Error(
                "Invalid recovery code. Check for typos and try again."
            );

        }

        // Guard: if the browser already holds a sync secret and
        // the newly-unwrapped one is different, refuse the
        // overwrite. Silently replacing the secret would make
        // every existing sync copy unreadable.
        const existing =
            await signalKeyStore.getSyncSecret();

        if (
            existing &&
            existing !== secret
        ) {

            throw new Error(
                "This recovery code decrypts to a different "
                + "key than the one already on this device. "
                + "Using it would erase access to your "
                + "existing messages. Enter the original "
                + "recovery code on a fresh browser instead, "
                + "or use the code from another device that "
                + "still has your history."
            );

        }

        await signalKeyStore.saveSyncSecret(secret, email);

        clearSyncKeyCache();

        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new Event("nexara:sync-unlocked")
            );
        }

        return secret;

    },

    // ======================================================
    // Unlock straight from a fresh registration response
    // (the code was just created — no need to type it)
    // ======================================================

    async unlockFromRegistration({
        code,
        salt,
        wrapped_key,
        email = null,
    }) {

        const secret = unwrapSyncSecret(
            code,
            salt,
            wrapped_key,
        );

        if (!secret) {

            throw new Error(
                "Recovery unlock failed."
            );

        }

        await signalKeyStore.saveSyncSecret(secret, email);

        clearSyncKeyCache();

        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new Event("nexara:sync-unlocked")
            );
        }

        return secret;

    },

// ======================================================
    // Request a NEW recovery code (Settings > Support)
    //
    // Pass the browser's own sync secret to re-wrap the SAME
    // secret (all history stays valid), or omit it to mint a
    // fresh account key (existing sync copies become unreadable
    // for future browsers). An email with a one-time link is
    // sent; the code itself is only revealed after the OTP step.
    // ======================================================

    async requestRecoveryCode(secretB64 = null, forceNew = false) {

        const response = await api.post(
            "/recovery/request",
            {
                secret_b64: secretB64 ?? null,
                force_new: forceNew,
            }
        );

        return response.data;

    },

    // ======================================================
    // Final step: link token + OTP -> new code + material
    //
    // No session required — the emailed link and an OTP for the
    // account email are the proof. Returns the fresh code with
    // its salt + wrapped secret, ready to unlock locally.
    // ======================================================

    async verifyRecovery({ token, email, otp }) {

        const response = await api.post(
            "/recovery/verify",
            {
                token,
                email,
                otp,
            }
        );

        return response.data;

    },

};

export default recoveryService;