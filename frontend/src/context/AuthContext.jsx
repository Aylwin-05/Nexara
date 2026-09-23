import {
    createContext,
    useContext,
    useEffect,
    useState,
} from "react";

import authService from "../services/authService";
import keyService from "../services/keyService";
import recoveryService from "../services/recoveryService";
import { ensureDeviceRegistered } from "../services/signalService";

import {
    generateIdentityKeys,
} from "../crypto/cryptoService";

import {
    hasKeyPair,
    saveKeyPair,
    getPublicKey,
    clearKeyPair,
} from "../crypto/keyStorage";

import {
    signalKeyStore,
} from "../crypto/signal/keyStore";

const AuthContext = createContext(null);

// ----------------------------------------------------------
// Per-account dismissal memory for the "Unlock your
// history" prompt. Once dismissed, the popup never comes
// back on this browser (manual unlock stays available in
// Settings > Support).
// ----------------------------------------------------------

function recoveryPromptKey(email) {

    return `nexara.recoveryPromptDismissed.` +
        `${(email || "").toLowerCase()}`;

}

export function AuthProvider({ children }) {

    const [user, setUser] = useState(
        authService.getStoredUser()
    );

    const [loading, setLoading] = useState(true);

    const [accessToken, setAccessToken] = useState(
        authService.getAccessToken()
    );

    // ------------------------------------------------------
    // Cross-device encryption state
    //
    // recoveryCode: a code MINTED BY THIS DEVICE's
    // registration — shown once ("I've saved it").
    // needsRecoveryEntry: this browser holds no sync secret
    // for an account that HAS one — prompt for the code so
    // encrypted history becomes readable here.
    // ------------------------------------------------------

    const [recoveryCode, setRecoveryCode] =
        useState(null);

    const [needsRecoveryEntry, setNeedsRecoveryEntry] =
        useState(false);

    // ==========================================================
    // Publish the RSA public key when the server lacks one
    //
    // Separate from Signal device registration: this is the
    // WebCrypto RSA-OAEP key used to wrap file keys for
    // stories / attachments. If it is missing server-side,
    // friends silently skip sealing keys for this account
    // and nothing decrypts.
    // ==========================================================

    async function ensurePublicKeyUploaded(profile) {

        if (!profile?.id) {

            return;

        }

        const known = await keyService
            .getPublicKey(profile.id)
            .then(() => true)
            .catch(() => false);

        if (known) {

            return;

        }

        let publicKey = await getPublicKey();

        if (!publicKey) {

            const keys =
                await generateIdentityKeys();

            await saveKeyPair(
                keys.publicKey,
                keys.privateKey,
            );

            publicKey = keys.publicKey;

        }

        await keyService.uploadPublicKey(
            publicKey
        );

    }

    // ==========================================================
    // Signal device registration + sync-secret check
    //
    // Without a registered device nobody seals envelopes to
    // this client and NOTHING decrypts. Runs from the boot
    // effect below — i.e. both after a fresh login (token
    // change re-runs the effect) and on page refresh.
    // ==========================================================

    async function setupEncryption() {

        const profile =
            authService.getStoredUser();

        if (!profile?.email) {

            return;

        }

        try {

            // Publish this browser's RSA public key if the
            // server does not have one yet. Without it, no
            // friend can seal a story/attachment/file key for
            // this account (and it silently stays undecryptable
            // for the viewer). Runs on every boot (login and
            // page refresh) so a one-off upload failure at
            // signup can never leave the account keyless.
            await ensurePublicKeyUploaded(profile);

            const registered =
                await ensureDeviceRegistered({
                    email: profile.email,
                });

            if (registered?.recoveryCode) {

                setRecoveryCode(
                    registered.recoveryCode
                );

                return;

            }

            // Account already had a recovery key. If THIS
            // browser holds no usable sync secret (none at
            // all, or one belonging to another account),
            // old history stays sealed until the code is
            // entered. New messages work either way.
            //
            // The prompt is shown AT MOST ONCE per account
            // on this browser: dismissal is remembered in
            // localStorage (unlock anytime via Settings >
            // Support), so users are never re-nagged.

            const syncRecord =
                await signalKeyStore.getSyncRecord();

            const staleSync =
                !!syncRecord?.secret &&
                !!syncRecord.email &&
                syncRecord.email !== profile.email;

            const promptAlreadyDismissed = Boolean(
                localStorage.getItem(
                    recoveryPromptKey(profile.email)
                )
            );

            if (
                profile.has_recovery_key &&
                (staleSync || !syncRecord?.secret) &&
                !promptAlreadyDismissed
            ) {

                setNeedsRecoveryEntry(true);

            }

        }

        catch (error) {

            console.error(
                "Device registration failed:",
                error
            );

        }

    }

    // ==========================================================
    // Session expired anywhere in the app
    //
    // The response interceptor fires this when a refresh attempt
    // fails (e.g. an expired refresh cookie or revoked family).
    // Drop local state so the route guards send the user to the
    // login screen without a hard page reload.
    // ==========================================================

    useEffect(() => {

        const onSessionExpired = () => {

            setUser(null);

            setAccessToken(null);

        };

        window.addEventListener(
            "nexara:auth-expired",
            onSessionExpired
        );

        return () =>
            window.removeEventListener(
                "nexara:auth-expired",
                onSessionExpired
            );

    }, []);

    // ==========================================================
    // Initialize Authentication
    // ==========================================================

    useEffect(() => {

        async function initialize() {

            if (!accessToken) {

                // No in-memory token (e.g. page reload).
                // Attempt a silent refresh using the HttpOnly
                // cookie before giving up — the session may
                // still be valid on the server.
                try {
                    const refreshed =
                        await authService.refreshAccessToken();
                    setAccessToken(refreshed);
                    return;
                } catch {
                    // No valid refresh cookie — truly logged out.
                    setLoading(false);
                    return;
                }

            }

            try {

                const profile =
                    await authService.loadCurrentUser();

                setUser(profile);

                setupEncryption();

            }

            catch (error) {

                console.error(error);

                authService.logout();

                setUser(null);

                setAccessToken(null);

            }

            finally {

                setLoading(false);

            }

        }

        initialize();

    }, [accessToken]);

    // ==========================================================
    // Login
    // ==========================================================

    const login = async (

        accessToken,

        refreshToken,

    ) => {

    try {

        await authService.login(
            accessToken,
            refreshToken,
        );

        // --------------------------------------------------
        // Generate identity only once
        // --------------------------------------------------

        if (!(await hasKeyPair())) {

            const keys =
                await generateIdentityKeys();

            await saveKeyPair(
                keys.publicKey,
                keys.privateKey,
            );

            await keyService.uploadPublicKey(
                keys.publicKey
            );
        }

        else {

            try {

                await keyService.uploadPublicKey(
                    getPublicKey()
                );

            }

            catch (e) {

                console.error(
                    "Public key re-upload failed.",
                    e
                );

            }

        }

            setAccessToken(
                accessToken
            );
        }

        catch (error) {

            console.error(error);

            throw error;

        };

    };

    // ==========================================================
    // Update Current User
    // ==========================================================

    const updateUser = (updatedUser) => {

        setUser(updatedUser);

        authService.saveUser(updatedUser);

    };

    // ==========================================================
    // Logout
    // ==========================================================

    const logout = async () => {

        authService.logout();

        await clearKeyPair();

        setUser(null);

        setAccessToken(null);

        setRecoveryCode(null);

        setNeedsRecoveryEntry(false);

    };

    // ==========================================================
    // Recovery modal handlers
    // ==========================================================

    const submitRecoveryCode = async (code) => {

        const email =
            user?.email ??
            authService.getStoredUser()?.email;

        await recoveryService.unlock(code, email);

        localStorage.removeItem(
            recoveryPromptKey(email)
        );

        setNeedsRecoveryEntry(false);

    };

    const dismissRecoveryEntry = () => {

        const email =
            user?.email ??
            authService.getStoredUser()?.email;

        if (email) {

            localStorage.setItem(
                recoveryPromptKey(email),
                "1"
            );

        }

        setNeedsRecoveryEntry(false);

    };

    const dismissRecoveryCode = () => {

        setRecoveryCode(null);

    };

    return (

        <AuthContext.Provider
            value={{
                user,
                loading,
                accessToken,
                login,
                logout,
                updateUser,
                isAuthenticated: !!user,
                recoveryCode,
                needsRecoveryEntry,
                submitRecoveryCode,
                dismissRecoveryEntry,
                dismissRecoveryCode,
            }}
        >

            {children}

        </AuthContext.Provider>

    );

}

export function useAuth() {

    const context =
        useContext(AuthContext);

    if (!context) {

        throw new Error(
            "useAuth must be used within AuthProvider"
        );

    }

    return context;

}
