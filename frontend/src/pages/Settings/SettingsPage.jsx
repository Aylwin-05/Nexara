import {
    useEffect,
    useRef,
    useState,
} from "react";

import toast from "react-hot-toast";
import { Link } from "react-router-dom";

import { getApiErrorDetail } from "../../utils/errors";
import UserAvatar, {
    bustAvatarCache,
} from "../../components/UserAvatar";
import PresencePet from "../../components/PresencePet";

import userService from "../../services/userService";

import recoveryService from "../../services/recoveryService";

import { signalKeyStore } from "../../crypto/signal/keyStore";

import { useAuth } from "../../context/AuthContext";

import { getTheme, setTheme } from "../../utils/theme";

import {
    getPushState,
    subscribe as subscribePush,
    unsubscribe as unsubscribePush,
    isSupported as pushSupported,
} from "../../services/pushService";

import blockService from "../../services/blockService";

import authService from "../../services/authService";

import appLock from "../../utils/appLock";
import { screenSecurity } from "../../utils/screenSecurity";

import api from "../../api/api";

import "./SettingsPage.css";

const PRIVACY_OPTIONS = [
    { value: "everyone", label: "Everyone" },
    { value: "my_contacts", label: "My contacts" },
    { value: "nobody", label: "Nobody" },
];

const PRIVACY_FIELDS = [
    {
        key: "last_seen",
        label: "Last seen & online",
        hint: "Who can see when you are online.",
    },
    {
        key: "profile_photo",
        label: "Profile photo",
        hint: "Who can see your profile photo.",
    },
    {
        key: "story",
        label: "Status updates",
        hint: "Who can see your 24h status updates.",
    },
];

const PRESENCE_ANIMALS = [
    {
        id: "default",
        label: "Username",
        description: "Your profile avatar — the classic look.",
    },
    {
        id: "cat",
        label: "Cat",
        description: "Blinking eyes and a twitchy ear.",
    },
    {
        id: "dog",
        label: "Doggie",
        description: "Panting tongue, breathing happily.",
    },
    {
        id: "owl",
        label: "Owl",
        description: "Sleepy blinks with a little bob.",
    },
    {
        id: "rabbit",
        label: "Bunny",
        description: "Wiggly ears while they wait.",
    },
];

const THEME_OPTIONS = [
    {
        id: "blue",
        label: "Blue",
        description: "Nebula blue — the signature Nexara look.",
        colors: ["#7c5cff", "#22d3ee"],
    },
    {
        id: "dark",
        label: "Dark",
        description: "Neutral deep black, easy on the eyes.",
        colors: ["#16181d", "#2a2d35"],
    },
    {
        id: "light",
        label: "Light",
        description: "Bright and clean for daytime use.",
        colors: ["#ffffff", "#dbe4f0"],
    },
];

export default function SettingsPage() {

    const {
        user,
        updateUser,
        logout,
    } = useAuth();

    const fileInputRef = useRef(null);

    const [username, setUsername] = useState(
        user?.username ?? ""
    );

    const [displayName, setDisplayName] = useState(
        user?.display_name ?? ""
    );

    const [saving, setSaving] = useState(false);

    const [uploading, setUploading] = useState(false);

    const [theme, setThemeState] = useState(getTheme());

    const [presenceAnimal, setPresenceAnimal] = useState(
        user?.presence_animal || "default"
    );

    const [confirmLogout, setConfirmLogout] = useState(false);
    const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");

    // ==========================================================
    // Web push notifications
    // ==========================================================

    const [pushState, setPushState] = useState("loading");

    const [pushBusy, setPushBusy] = useState(false);

    // ==========================================================
    // Privacy (last seen / photo / status)
    // ==========================================================

    const [privacy, setPrivacy] = useState({
        last_seen: "everyone",
        profile_photo: "everyone",
        story: "my_contacts",
    });

    const [privacyBusy, setPrivacyBusy] = useState(false);

    // ==========================================================
    // Blocked users
    // ==========================================================

    const [blockedUsers, setBlockedUsers] = useState([]);

    const [blockedBusy, setBlockedBusy] = useState(false);

    const [unblockBusyId, setUnblockBusyId] = useState(null);

    // ==========================================================
    // Two-step verification (server-side 2FA PIN)
    // ==========================================================

    const [twoFA, setTwoFA] = useState({
        enabled: false,
        loading: true,
    });

    const [twoFAMode, setTwoFAMode] = useState("idle"); // idle | setup | teardown

    const [twoFABusy, setTwoFABusy] = useState(false);

    const [twoFAError, setTwoFAError] = useState("");

    const [twoFAPin, setTwoFAPin] = useState("");

    const [twoFAConfirm, setTwoFAConfirm] = useState("");

    // ==========================================================
    // App lock (local device PIN)
    // ==========================================================

    const [appLockMode, setAppLockMode] = useState("idle"); // idle | setup | change | teardown

    const [appLockEnabled, setAppLockEnabled] = useState(false);

    const [appLockBusy, setAppLockBusy] = useState(false);

    const [appLockError, setAppLockError] = useState("");

    const [appLockPin, setAppLockPin] = useState("");

    const [appLockConfirm, setAppLockConfirm] = useState("");

    const [appLockCurrent, setAppLockCurrent] = useState("");

    // ==========================================================
    // Screen security (privacy blur on lost focus)
    // ==========================================================

    const [privacyBlur, setPrivacyBlurState] = useState(
        screenSecurity.isPrivacyBlurEnabled()
    );

    useEffect(() => {

        blockService.getPrivacy()
            .then(setPrivacy)
            .catch(() => {});

        blockService.getBlockedUsers()
            .then(setBlockedUsers)
            .catch(() => {});

        appLock.isConfigured()
            .then(setAppLockEnabled)
            .catch(() => {});

        authService.getTwoFAStatus()
            .then(({ two_fa_enabled }) =>
                setTwoFA({
                    enabled: two_fa_enabled,
                    loading: false,
                })
            )
            .catch(() =>
                setTwoFA(previous => ({
                    ...previous,
                    loading: false,
                }))
            );

    }, []);

    async function handlePrivacyChange(field, value) {

        if (privacyBusy) return;

        const previous = privacy;

        setPrivacy({
            ...privacy,
            [field]: value,
        });

        setPrivacyBusy(true);

        try {

            const updated =
                await blockService.updatePrivacy({
                    [field]: value,
                });

            setPrivacy(updated);

        }
        catch (error) {

            setPrivacy(previous);

            toast.error(getApiErrorDetail(error, "Unable to update privacy settings."));

        }
        finally {

            setPrivacyBusy(false);

        }

    }

    async function handleUnblock(userId) {

        if (unblockBusyId) return;

        setUnblockBusyId(userId);

        try {

            await blockService.unblockUser(userId);

            setBlockedUsers(users =>
                users.filter(user => user.id !== userId)
            );

            toast.success("User unblocked.");

        }
        catch (error) {

            toast.error(getApiErrorDetail(error, "Unable to unblock this user."));

        }
        finally {

            setUnblockBusyId(null);

        }

    }

    // ==========================================================
    // Two-step verification handlers
    // ==========================================================

    async function handleEnableTwoFA(event) {

        event.preventDefault();

        if (twoFABusy) return;

        setTwoFAError("");

        if (twoFAPin.length !== 6) {

            setTwoFAError("PIN must be 6 digits.");

            return;

        }

        if (twoFAPin !== twoFAConfirm) {

            setTwoFAError("The PINs do not match.");

            return;

        }

        setTwoFABusy(true);

        try {

            const status =
                await authService.enableTwoFA(
                    twoFAPin,
                    twoFAConfirm
                );

            setTwoFA({
                enabled: status.two_fa_enabled,
                loading: false,
            });

            setTwoFAMode("idle");

            setTwoFAPin("");

            setTwoFAConfirm("");

            toast.success(
                "Two-step verification is now on."
            );

        }
        catch (error) {

            setTwoFAError(getApiErrorDetail(error, "Unable to enable two-step verification."));

        }
        finally {

            setTwoFABusy(false);

        }

    }

    async function handleDisableTwoFA(event) {

        event.preventDefault();

        if (twoFABusy) return;

        setTwoFAError("");

        if (twoFAPin.length !== 6) {

            setTwoFAError(
                "Enter your current PIN to turn it off."
            );

            return;

        }

        setTwoFABusy(true);

        try {

            const status =
                await authService.disableTwoFA(twoFAPin);

            setTwoFA({
                enabled: status.two_fa_enabled,
                loading: false,
            });

            setTwoFAMode("idle");

            setTwoFAPin("");

            setTwoFAConfirm("");

            toast.success(
                "Two-step verification is now off."
            );

        }
        catch (error) {

            setTwoFAError(getApiErrorDetail(error, "Unable to disable two-step verification."));

        }
        finally {

            setTwoFABusy(false);

        }

    }

    // ==========================================================
    // Screen security handlers
    // ==========================================================

    function togglePrivacyBlur() {
        const next = !privacyBlur;
        screenSecurity.setPrivacyBlurEnabled(next);
        setPrivacyBlurState(next);
    }

    // ==========================================================
    // App lock handlers
    // ==========================================================

    async function handleAppLockSubmit(event) {

        event.preventDefault();

        if (appLockBusy) return;

        setAppLockError("");

        if (appLockMode === "teardown") {

            if (appLockCurrent.length < 4) {

                setAppLockError(
                    "Enter your current PIN to turn it off."
                );

                return;

            }

        }
        else if (!appLock.isValidPin(appLockPin)) {

            setAppLockError("PIN must be 4–6 digits.");

            return;

        }

        setAppLockBusy(true);

        try {

            if (appLockMode === "setup") {

                if (appLockPin !== appLockConfirm) {

                    setAppLockError(
                        "The PINs do not match."
                    );

                    setAppLockBusy(false);

                    return;

                }

                await appLock.setPin(appLockPin);

                setAppLockEnabled(true);

                toast.success(
                    "App lock is now on for this device."
                );

            }
            else if (appLockMode === "change") {

                await appLock.changePin(
                    appLockCurrent,
                    appLockPin
                );

                toast.success(
                    "App lock PIN updated."
                );

            }
            else if (appLockMode === "teardown") {

                const verdict =
                    await appLock.verify(appLockCurrent);

                if (!verdict.valid || verdict.notConfigured) {

                    setAppLockError(
                        verdict.notConfigured
                            ? "No PIN is configured on this device."
                            : "The current PIN is incorrect."
                    );

                    setAppLockBusy(false);

                    return;

                }

                appLock.removePin();

                setAppLockEnabled(false);

                toast.success(
                    "App lock is now off for this device."
                );

            }

            setAppLockMode("idle");

            setAppLockPin("");

            setAppLockConfirm("");

            setAppLockCurrent("");

        }
        catch (error) {

            setAppLockError(
                error?.message ||
                "Unable to update app lock."
            );

        }
        finally {

            setAppLockBusy(false);

        }

    }

    useEffect(() => {

        getPushState()
            .then(setPushState)
            .catch(() => setPushState("disabled"));

    }, []);

    async function handleToggleNotifications() {

        if (pushBusy) return;

        setPushBusy(true);

        try {

            if (pushState === "enabled") {

                await unsubscribePush();

                setPushState("disabled");

            }
            else {

                const ok = await subscribePush();

                setPushState(
                    ok ? "enabled" : await getPushState()
                );

            }

        }
        catch (error) {

            console.error(error);

            toast.error(
                "Could not change notification settings."
            );

        }
        finally {

            setPushBusy(false);

        }

    }

    // ==========================================================
    // Support: recover a lost/forgotten recovery code
    //
    // The request is limited to 3 per 10 minutes per email; the
    // ring timer below mirrors that window (the server reports
    // the remaining seconds).
    // ==========================================================

    const [recoveryBusy, setRecoveryBusy] = useState(false);

    const [recoverySent, setRecoverySent] = useState(false);

    const [recoveryHasSecret, setRecoveryHasSecret] = useState(false);

    const [recoveryRemaining, setRecoveryRemaining] = useState(3);

    const [recoveryCooldown, setRecoveryCooldown] = useState(0);

    const [recoveryError, setRecoveryError] = useState(null);

    const [confirmFreshKey, setConfirmFreshKey] = useState(false);

    const [forceNewConfirm, setForceNewConfirm] = useState(false);

    // Enter-an-existing-code box (already-logged-in unlock)
    const [unlockCode, setUnlockCode] = useState("");

    const [unlockBusy, setUnlockBusy] = useState(false);

    const [unlockError, setUnlockError] = useState(null);

    const [unlocked, setUnlocked] = useState(false);

    useEffect(() => {

        recoveryService.hasSyncSecret()
            .then(setRecoveryHasSecret)
            .catch(() => {});

    }, []);

    useEffect(() => {

        if (recoveryCooldown <= 0) return;

        const timer = setTimeout(
            () => setRecoveryCooldown(
                previous => previous - 1
            ),
            1000,
        );

        return () => clearTimeout(timer);

    }, [recoveryCooldown]);

    async function handleUnlockCode(event) {

        event.preventDefault();

        if (unlockBusy) return;

        setUnlockBusy(true);

        setUnlockError(null);

        try {

            await recoveryService.unlock(unlockCode);

            setUnlocked(true);

            setRecoveryHasSecret(true);

            toast.success(
                "History unlocked on this browser."
            );

        }
        catch (err) {

            setUnlockError(
                err?.message ||
                "That code didn't work. Check it and try again."
            );

        }
        finally {

            setUnlockBusy(false);

        }

    }

    function formatCooldown(seconds) {

        const m = Math.floor(seconds / 60);

        const s = seconds % 60;

        return `${m}:${String(s).padStart(2, "0")}`;

    }

    async function handleRecoverCode(forceNew = false) {

        if (
            recoveryBusy ||
            (
                recoveryRemaining <= 0 &&
                recoveryCooldown > 0
            )
        ) {
            return;
        }

        setRecoveryBusy(true);

        setRecoveryError(null);

        setConfirmFreshKey(false);

        setForceNewConfirm(false);

        try {

            // Re-wrap the SAME secret when this browser has it
            // (lossless: every existing sync copy stays valid).
            // When this device holds no secret yet, the backend
            // refuses to mint a fresh key if the account has sync
            // copies that would be orphaned (409) — this device
            // must then confirm the loss explicitly (forceNew)
            // after the forceNewConfirm stage.
            const secret =
                await signalKeyStore.getSyncSecret();

            const data =
                await recoveryService.requestRecoveryCode(
                    secret || null,
                    forceNew,
                );

            setRecoverySent(true);

            setRecoveryRemaining(data.remaining);

            setRecoveryCooldown(data.retry_after);

            toast.success(
                "Recovery link sent — check your inbox."
            );

        }
        catch (err) {

            const retryAfter =
                err?.response?.headers?.["retry-after"];

            if (err?.response?.status === 409 && !forceNew) {

                const orphaned =
                    err?.response?.headers?.[
                        "x-orphaned-messages"
                    ];

                setForceNewConfirm(true);

                setRecoveryError(
                    orphaned
                        ? `This account has ${orphaned} synced ` +
                          "message(s) that a new key would lock " +
                          "forever. Enter your recovery code to " +
                          "unlock here first, or request from a " +
                          "browser that already has your history."
                        : err?.response?.data?.detail ||
                          "A new key is blocked because it would " +
                          "lock existing history."
                );

            }
            else if (retryAfter) {

                setRecoveryCooldown(Number(retryAfter));

                setRecoveryRemaining(0);

                setRecoveryError(
                    "You have used all 3 requests for this " +
                    "10-minute window. Try again when the " +
                    "timer reaches zero."
                );

            }
            else {

                setRecoveryError(
                    err?.response?.data?.detail ||
                    err?.message ||
                    "Could not request the recovery link."
                );

            }

        }
        finally {

            setRecoveryBusy(false);

        }

    }

    // ==========================================================
    // Save profile (username + display name)
    // ==========================================================

    async function handleSaveProfile(event) {
        event.preventDefault();

        if (saving) return;

        setSaving(true);

        try {
            const updated =
                await userService.updateProfile({
                    username: username.trim(),
                    display_name: displayName.trim(),
                });

            updateUser(updated);

            toast.success("Profile updated.");
        }
        catch (error) {
            const detail = getApiErrorDetail(error, "Unable to update profile.");

            toast.error(detail);
        }
        finally {
            setSaving(false);
        }
    }

    // ==========================================================
    // Avatar upload
    // ==========================================================

    async function handleAvatarChange(event) {
        const file = event.target.files?.[0];

        if (!file) return;

        if (uploading) return;

        if (!file.type.startsWith("image/")) {
            toast.error("Please choose an image file.");
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            toast.error("Avatar must be smaller than 5 MB.");
            return;
        }

        setUploading(true);

        try {
            const updated =
                await userService.uploadAvatar(file);

            updateUser(updated);

            bustAvatarCache(user.id);

            toast.success("Avatar updated.");
        }
        catch (error) {
            const detail = getApiErrorDetail(error, "Unable to upload avatar.");

            toast.error(detail);
        }
        finally {
            setUploading(false);

            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    }

    // ==========================================================
    // Theme
    // ==========================================================

    function handleThemeChange(themeId) {
        setTheme(themeId);

        setThemeState(themeId);
    }

    // ==========================================================
    // In-chat presence pet
    // ==========================================================

    async function handlePresenceAnimalChange(animalId) {

        if (animalId === presenceAnimal) return;

        setPresenceAnimal(animalId);

        try {

            const updated =
                await userService.updateProfile({
                    presence_animal: animalId,
                });

            updateUser(updated);

            toast.success("In-chat presence updated.");
        }
        catch (error) {

            setPresenceAnimal(
                user?.presence_animal || "default"
            );

            toast.error(
                getApiErrorDetail(
                    error,
                    "Unable to update presence.",
                )
            );

        }

    }

    // ==========================================================
    // Logout
    // ==========================================================

    function handleLogout() {
        logout();
    }

    // ==========================================================
    // Account Deletion (GDPR)
    // ==========================================================

    async function handleDeleteAccount() {
        if (deleteConfirmText !== "YES_DELETE") return;

        try {
            await api.delete("/auth/account?confirm=YES_DELETE");
            toast.success("Account deleted.");
            logout();
        } catch (err) {
            toast.error(getApiErrorDetail(err, "Failed to delete account."));
        }
    }

    // Enter-an-existing-code box — shown in EVERY support state
    // (idle, fresh-key confirm, link-sent) so the user can unlock
    // without leaving the page.
    const recoveryUnlockBox = (
        <div className="recovery-unlock-box">
            <details>
                <summary>
                    {recoveryHasSecret
                        ? "Have a different code? Re-unlock this browser"
                        : "Already have your code? Unlock this browser"}
                </summary>

                {recoveryHasSecret && (
                    <p className="recovery-support-hint">
                        This browser already has a sync secret stored.
                        Entering a code that decrypts to a
                        <strong> different </strong>
                        key will be refused to protect your existing
                        messages.
                    </p>
                )}

                <form
                    className="recovery-unlock-form"
                    onSubmit={handleUnlockCode}
                >
                    <input
                        type="text"
                        className="recovery-unlock-input"
                        placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                        value={unlockCode}
                        onChange={event =>
                            setUnlockCode(
                                event.target.value.toUpperCase()
                            )
                        }
                        spellCheck={false}
                    />

                    <button
                        type="submit"
                        className="btn-ghost"
                        disabled={
                            unlockBusy ||
                            unlockCode.length < 20
                        }
                    >
                        {unlockBusy
                            ? "Unlocking…"
                            : "Unlock"}
                    </button>
                </form>

                {unlockError && (
                    <p className="recovery-support-error">
                        {unlockError}
                    </p>
                )}

                {unlocked && (
                    <p className="recovery-unlock-ok">
                        This browser is now unlocked —
                        the full history is readable
                        here.
                    </p>
                )}
            </details>
        </div>
    );

    return (

        <div className="settings-page stage-panel">

            <div className="settings-header">

                <h2>Settings</h2>

                <p>
                    Manage your profile, appearance and account.
                </p>

            </div>

            {/* ------- profile ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>Profile</h3>

                    <p>
                        Your name and avatar are visible to your
                        friends.
                    </p>

                </div>

                <div className="profile-row">

                    <div className="profile-avatar-wrap">

                        <UserAvatar
                            user={user}
                            className="settings-avatar"
                        />

                        {uploading && (
                            <span className="settings-avatar-badge spinner spinner-sm" />
                        )}

                    </div>

                    <div className="profile-avatar-actions">

                        <button
                            type="button"
                            className="btn-ghost"
                            disabled={uploading}
                            onClick={() =>
                                fileInputRef.current?.click()
                            }
                        >
                            Change avatar
                        </button>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            hidden
                            onChange={handleAvatarChange}
                        />

                        <small>
                            JPG, PNG, WebP or GIF up to 5 MB.
                        </small>

                    </div>

                </div>

                <form
                    className="settings-form"
                    onSubmit={handleSaveProfile}
                >

                    <div className="settings-field">

                        <label htmlFor="settings-username">
                            Username
                        </label>

                        <input
                            id="settings-username"
                            type="text"
                            value={username}
                            onChange={(e) =>
                                setUsername(e.target.value)
                            }
                            minLength={3}
                            maxLength={30}
                            pattern="[a-zA-Z0-9_.\-]+"
                            required
                            autoComplete="off"
                        />

                        <small>
                            3–30 characters: letters, numbers, . _ -
                        </small>

                    </div>

                    <div className="settings-field">

                        <label htmlFor="settings-display-name">
                            Display name
                        </label>

                        <input
                            id="settings-display-name"
                            type="text"
                            value={displayName}
                            onChange={(e) =>
                                setDisplayName(e.target.value)
                            }
                            minLength={2}
                            maxLength={50}
                            required
                            autoComplete="off"
                        />

                        <small>
                            What your friends see in chats.
                        </small>

                    </div>

                    <div className="settings-actions">

                        <button
                            type="submit"
                            className="btn-primary"
                            disabled={saving || uploading}
                        >
                            {saving ? "Saving…" : "Save changes"}
                        </button>

                    </div>

                </form>

            </section>

            {/* ------- appearance ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>Appearance</h3>

                    <p>
                        Pick the Nexara theme you like.
                    </p>

                </div>

                <div className="theme-grid">

                    {THEME_OPTIONS.map((option) => {

                        const active = theme === option.id;

                        return (

                            <button
                                key={option.id}
                                type="button"
                                className={
                                    active
                                        ? "theme-option active"
                                        : "theme-option"
                                }
                                onClick={() =>
                                    handleThemeChange(option.id)
                                }
                            >

                                <span
                                    className="theme-swatch"
                                    style={{
                                        background: `linear-gradient(135deg, ${option.colors[0]}, ${option.colors[1]})`,
                                    }}
                                />

                                <span className="theme-meta">

                                    <strong>{option.label}</strong>

                                    <small>{option.description}</small>

                                </span>

                                <span className="theme-check">
                                    {active ? "✓" : ""}
                                </span>

                            </button>

                        );

                    })}

                </div>

            </section>

            {/* ------- in-chat presence ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>In-chat presence</h3>

                    <p>
                        When you have a chat open, your friends see
                        your chosen pet at the bottom of their chat
                        as a subtle &quot;someone is here&quot; hint.
                        Online status stays separate — your pet only
                        shows while you are actually viewing the chat.
                    </p>

                </div>

                <div className="theme-grid">

                    {PRESENCE_ANIMALS.map((option) => {

                        const active =
                            presenceAnimal === option.id;

                        return (

                            <button
                                key={option.id}
                                type="button"
                                aria-pressed={active}
                                className={
                                    active
                                        ? "theme-option active"
                                        : "theme-option"
                                }
                                onClick={() =>
                                    handlePresenceAnimalChange(option.id)
                                }
                            >

                                <span className="presence-pet-preview">
                                    {option.id === "default" ? (
                                        <UserAvatar
                                            user={user}
                                            className="presence-pet-avatar"
                                        />
                                    ) : (
                                        <PresencePet
                                            style={option.id}
                                        />
                                    )}
                                </span>

                                <span className="theme-meta">

                                    <strong>{option.label}</strong>

                                    <small>{option.description}</small>

                                </span>

                                <span className="theme-check">
                                    {active ? "✓" : ""}
                                </span>

                            </button>

                        );

                    })}

                </div>

            </section>

            {/* ------- notifications ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>Notifications</h3>

                    <p>
                        Get browser notifications for new messages
                        and status updates, even when Nexara is
                        in the background or closed. Notifications
                        are privacy-safe: they never reveal message
                        content — it stays encrypted.
                    </p>

                </div>

                <div className="settings-row">

                    <div className="settings-row-text">
                        <strong>Web notifications</strong>
                        <small>
                            {pushState === "loading"
                                ? "Checking…"
                                : pushState === "unsupported"
                                    ? "Not supported by this browser."
                                    : pushState === "blocked"
                                        ? "Notifications are blocked — "
                                          + "enable them in your browser "
                                          + "settings."
                                        : pushState === "enabled"
                                            ? "Enabled on this browser."
                                            : "Receive notifications on "
                                              + "this device."}
                        </small>
                    </div>

                    {pushSupported() && (
                        <button
                            type="button"
                            className={
                                pushState === "enabled"
                                    ? "btn-ghost"
                                    : "btn-primary"
                            }
                            onClick={handleToggleNotifications}
                            disabled={
                                pushState === "loading" ||
                                pushBusy ||
                                pushState === "blocked" ||
                                pushState === "unsupported"
                            }
                        >
                            {pushBusy
                                ? "Working…"
                                : pushState === "enabled"
                                    ? "Disable"
                                    : "Enable"}
                        </button>
                    )}

                </div>

            </section>

            {/* ------- privacy ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>Privacy</h3>

                    <p>
                        Control who can see your online status,
                        profile photo and status updates. Blocked
                        users can never see any of these.
                    </p>

                </div>

                <div className="privacy-list">

                    {PRIVACY_FIELDS.map(field => (

                        <div
                            key={field.key}
                            className="settings-row"
                        >

                            <div className="settings-row-text">

                                <strong>{field.label}</strong>

                                <small>{field.hint}</small>

                            </div>

                            <select
                                className="privacy-select"
                                value={privacy[field.key]}
                                disabled={privacyBusy}
                                onChange={(e) =>
                                    handlePrivacyChange(
                                        field.key,
                                        e.target.value,
                                    )
                                }
                            >

                                {PRIVACY_OPTIONS.map(option => (

                                    <option
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </option>

                                ))}

                            </select>

                        </div>

                    ))}

                </div>

            </section>

            {/* ------- blocked users ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>Blocked users</h3>

                    <p>
                        Blocked users cannot message or call you,
                        and cannot see your presence, status
                        updates or profile photo. You also stop
                        seeing theirs. Blocking removes them from
                        your friends.
                    </p>

                </div>

                {blockedUsers.length === 0 ? (

                    <div className="settings-row">

                        <div className="settings-row-text">

                            <strong>No blocked users</strong>

                            <small>
                                Block someone from their chat
                                header to stop them contacting
                                you.
                            </small>

                        </div>

                    </div>

                ) : (

                    <div className="blocked-list">

                        {blockedUsers.map(user => (

                            <div
                                key={user.id}
                                className="blocked-row"
                            >

                                <UserAvatar
                                    user={user}
                                    className="blocked-avatar"
                                />

                                <div className="blocked-meta">

                                    <strong>
                                        {user.display_name}
                                    </strong>

                                    <small>
                                        @{user.username}
                                    </small>

                                </div>

                                <button
                                    type="button"
                                    className="btn-ghost"
                                    disabled={
                                        unblockBusyId === user.id
                                    }
                                    onClick={() =>
                                        handleUnblock(user.id)
                                    }
                                >
                                    {unblockBusyId === user.id
                                        ? "Unblocking…"
                                        : "Unblock"}
                                </button>

                            </div>

                        ))}

                    </div>

                )}

            </section>

            {/* ------- two-step verification ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>Two-step verification</h3>

                    <p>
                        A 6-digit PIN that must be entered after
                        the email code when you log in on a new
                        device. If you forget it, you can reset
                        it with your email code.
                    </p>

                </div>

                {twoFA.loading ? (

                    <div className="settings-row">

                        <div className="settings-row-text">

                            <strong>Checking…</strong>

                            <small>
                                Loading two-step verification
                                status.
                            </small>

                        </div>

                    </div>

                ) : twoFA.enabled ? (

                    <div className="settings-actions">

                        {twoFAMode === "idle" ? (

                            <div className="settings-row">

                                <div className="settings-row-text">

                                    <strong>
                                        Two-step verification is on
                                    </strong>

                                    <small>
                                        Your PIN is required after
                                        the email code on new
                                        devices.
                                    </small>

                                </div>

                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() => {
                                        setTwoFAMode("teardown");

                                        setTwoFAError("");
                                    }}
                                >
                                    Turn off
                                </button>

                            </div>

                        ) : (

                            <form
                                className="settings-form"
                                onSubmit={handleDisableTwoFA}
                            >

                                <div className="settings-field">

                                    <label htmlFor="twofa-disable-pin">
                                        Current PIN
                                    </label>

                                    <input
                                        id="twofa-disable-pin"
                                        type="password"
                                        maxLength={6}
                                        placeholder="••••••"
                                        value={twoFAPin}
                                        onChange={(e) =>
                                            setTwoFAPin(
                                                e.target.value.replace(/\D/g, "")
                                            )
                                        }
                                        inputMode="numeric"
                                        autoComplete="off"
                                    />

                                </div>

                                {twoFAError && (

                                    <p className="settings-field-error">
                                        {twoFAError}
                                    </p>

                                )}

                                <div className="settings-actions">

                                    <button
                                        type="button"
                                        className="btn-ghost"
                                        onClick={() => {
                                            setTwoFAMode("idle");

                                            setTwoFAPin("");

                                            setTwoFAError("");
                                        }}
                                        disabled={twoFABusy}
                                    >
                                        Cancel
                                    </button>

                                    <button
                                        type="submit"
                                        className="btn-danger"
                                        disabled={twoFABusy}
                                    >
                                        {twoFABusy
                                            ? "Turning off…"
                                            : "Turn off 2FA"}
                                    </button>

                                </div>

                            </form>

                        )}

                    </div>

                ) : twoFAMode === "setup" ? (

                    <form
                        className="settings-form"
                        onSubmit={handleEnableTwoFA}
                    >

                        <div className="settings-field">

                            <label htmlFor="twofa-pin">
                                New PIN (6 digits)
                            </label>

                            <input
                                id="twofa-pin"
                                type="password"
                                maxLength={6}
                                placeholder="••••••"
                                value={twoFAPin}
                                onChange={(e) =>
                                    setTwoFAPin(
                                        e.target.value.replace(/\D/g, "")
                                    )
                                }
                                inputMode="numeric"
                                autoComplete="off"
                            />

                        </div>

                        <div className="settings-field">

                            <label htmlFor="twofa-confirm">
                                Confirm PIN
                            </label>

                            <input
                                id="twofa-confirm"
                                type="password"
                                maxLength={6}
                                placeholder="••••••"
                                value={twoFAConfirm}
                                onChange={(e) =>
                                    setTwoFAConfirm(
                                        e.target.value.replace(/\D/g, "")
                                    )
                                }
                                inputMode="numeric"
                                autoComplete="off"
                            />

                        </div>

                        {twoFAError && (

                            <p className="settings-field-error">
                                {twoFAError}
                            </p>

                        )}

                        <div className="settings-actions">

                            <button
                                type="button"
                                className="btn-ghost"
                                onClick={() => {
                                    setTwoFAMode("idle");

                                    setTwoFAPin("");

                                    setTwoFAConfirm("");

                                    setTwoFAError("");
                                }}
                                disabled={twoFABusy}
                            >
                                Cancel
                            </button>

                            <button
                                type="submit"
                                className="btn-primary"
                                disabled={twoFABusy}
                            >
                                {twoFABusy
                                    ? "Enabling…"
                                    : "Turn on"}
                            </button>

                        </div>

                    </form>

                ) : (

                    <div className="settings-actions">

                        <div className="settings-row">

                            <div className="settings-row-text">

                                <strong>
                                    Two-step verification is off
                                </strong>

                                <small>
                                    Add an extra PIN layer to your
                                    account logins.
                                </small>

                            </div>

                            <button
                                type="button"
                                className="btn-primary"
                                onClick={() => {
                                    setTwoFAMode("setup");

                                    setTwoFAError("");
                                }}
                            >
                                Turn on
                            </button>

                        </div>

                    </div>

                )}

            </section>

            {/* ------- app lock ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>App lock</h3>

                    <p>
                        Lock Nexara on this device with a
                        4–6 digit PIN. It&apos;s local only — never
                        sent to our servers. Forgot it? Use
                        &quot;Forgot PIN&quot; on the lock screen to
                        reset it.
                    </p>

                </div>

                <div className="settings-actions">

                    {appLockMode === "setup" ? (

                        <form
                            className="settings-form"
                            onSubmit={handleAppLockSubmit}
                        >

                            <div className="settings-field">

                                <label htmlFor="applock-pin">
                                    New PIN (4–6 digits)
                                </label>

                                <input
                                    id="applock-pin"
                                    type="password"
                                    maxLength={6}
                                    placeholder="••••••"
                                    value={appLockPin}
                                    onChange={(e) =>
                                        setAppLockPin(
                                            e.target.value.replace(/\D/g, "")
                                        )
                                    }
                                    inputMode="numeric"
                                    autoComplete="off"
                                />

                            </div>

                            <div className="settings-field">

                                <label htmlFor="applock-confirm">
                                    Confirm PIN
                                </label>

                                <input
                                    id="applock-confirm"
                                    type="password"
                                    maxLength={6}
                                    placeholder="••••••"
                                    value={appLockConfirm}
                                    onChange={(e) =>
                                        setAppLockConfirm(
                                            e.target.value.replace(/\D/g, "")
                                        )
                                    }
                                    inputMode="numeric"
                                    autoComplete="off"
                                />

                            </div>

                            {appLockError && (

                                <p className="settings-field-error">
                                    {appLockError}
                                </p>

                            )}

                            <div className="settings-actions">

                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() => {
                                        setAppLockMode("idle");

                                        setAppLockPin("");

                                        setAppLockConfirm("");

                                        setAppLockError("");
                                    }}
                                    disabled={appLockBusy}
                                >
                                    Cancel
                                </button>

                                <button
                                    type="submit"
                                    className="btn-primary"
                                    disabled={appLockBusy}
                                >
                                    {appLockBusy
                                        ? "Enabling…"
                                        : "Turn on"}
                                </button>

                            </div>

                        </form>

                    ) : appLockMode === "change" || appLockMode === "teardown" ? (

                        <form
                            className="settings-form"
                            onSubmit={handleAppLockSubmit}
                        >

                            <div className="settings-field">

                                <label htmlFor="applock-current">
                                    Current PIN
                                </label>

                                <input
                                    id="applock-current"
                                    type="password"
                                    maxLength={6}
                                    placeholder="••••••"
                                    value={appLockCurrent}
                                    onChange={(e) =>
                                        setAppLockCurrent(
                                            e.target.value.replace(/\D/g, "")
                                        )
                                    }
                                    inputMode="numeric"
                                    autoComplete="off"
                                />

                            </div>

                            {appLockMode === "change" && (

                                <div className="settings-field">

                                    <label htmlFor="applock-new">
                                        New PIN (4–6 digits)
                                    </label>

                                    <input
                                        id="applock-new"
                                        type="password"
                                        maxLength={6}
                                        placeholder="••••••"
                                        value={appLockPin}
                                        onChange={(e) =>
                                            setAppLockPin(
                                                e.target.value.replace(/\D/g, "")
                                            )
                                        }
                                        inputMode="numeric"
                                        autoComplete="off"
                                    />

                                </div>

                            )}

                            {appLockError && (

                                <p className="settings-field-error">
                                    {appLockError}
                                </p>

                            )}

                            <div className="settings-actions">

                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() => {
                                        setAppLockMode("idle");

                                        setAppLockPin("");

                                        setAppLockCurrent("");

                                        setAppLockError("");
                                    }}
                                    disabled={appLockBusy}
                                >
                                    Cancel
                                </button>

                                <button
                                    type="submit"
                                    className={
                                        appLockMode === "teardown"
                                            ? "btn-danger"
                                            : "btn-primary"
                                    }
                                    disabled={appLockBusy}
                                >
                                    {appLockBusy
                                        ? "Working…"
                                        : appLockMode === "teardown"
                                            ? "Turn off"
                                            : "Change PIN"}
                                </button>

                            </div>

                        </form>

                    ) : (

                        <div className="settings-row">

                            <div className="settings-row-text">

                                <strong>
                                    {appLockEnabled
                                        ? "App lock is on for this device"
                                        : "App lock is off"}
                                </strong>

                                <small>
                                    {appLockEnabled
                                        ? "Nexara asks for this PIN when you open the app in this browser."
                                        : "Anyone with this device can open Nexara without a PIN."}
                                </small>

                            </div>

                            <div className="settings-row-buttons">

                                {appLockEnabled && (
                                    <button
                                        type="button"
                                        className="btn-ghost"
                                        onClick={() => {
                                            setAppLockMode("change");

                                            setAppLockError("");
                                        }}
                                    >
                                        Change PIN
                                    </button>
                                )}

                                <label
                                    className="switch"
                                    title={appLockEnabled
                                        ? "Turn off app lock"
                                        : "Turn on app lock"}
                                >

                                    <input
                                        type="checkbox"
                                        checked={appLockEnabled}
                                        disabled={appLockBusy || appLockMode !== "idle"}
                                        onChange={() => {
                                            if (appLockEnabled) {
                                                setAppLockMode("teardown");
                                            }
                                            else {
                                                setAppLockMode("setup");
                                            }

                                            setAppLockError("");
                                        }}
                                    />

                                    <span className="switch-track">
                                        <span className="switch-thumb" />
                                    </span>

                                </label>

                            </div>

                        </div>

                    )}

                </div>

            </section>

            {/* ------- screen security ------- */}

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>Screen security</h3>

                    <p>
                        When privacy blur is on, chat content is
                        hidden whenever Nexara loses focus (switching
                        tabs or minimizing the window), so the app
                        switcher never shows your last message.
                    </p>

                </div>

                <div className="settings-actions">

                    <div className="settings-row">

                        <div className="settings-row-text">

                            <strong>Privacy blur</strong>

                            <span>
                                Hide chat content when the app
                                is not in view
                            </span>

                        </div>

                        <label className="switch">

                            <input
                                type="checkbox"
                                checked={privacyBlur}
                                onChange={togglePrivacyBlur}
                            />

                            <span className="switch-track">
                                <span className="switch-thumb" />
                            </span>

                        </label>

                    </div>

                </div>

            </section>

            {/* ------- support ------- */}

            <section className="settings-card support-zone">

                <div className="settings-card-head">

                    <h3>Support</h3>

                    <p>
                        Lost or deleted your recovery code? We can
                        send you a new one — after confirming it
                        is really you.
                    </p>

                </div>

                {recoverySent ? (

                    <div className="settings-actions">

                        <div className="recovery-support-note">
                            A recovery link has been sent to your
                            email. Open it, enter the verification
                            code, and your new recovery code will be
                            shown on screen. It replaces the old one
                            (which stops working) and restores the
                            same synced history.
                        </div>

                        {recoveryUnlockBox}

                    </div>

                ) : !recoveryHasSecret && confirmFreshKey ? (

                    <div className="settings-actions">

                        <div className="logout-confirm">
                            <span>
                                This browser has not unlocked the sync
                                secret yet. Requesting from here will
                                create a <strong>new account key</strong> —
                                history synced before this moment won&apos;t
                                be readable on future browsers (it stays
                                readable on browsers that already have
                                the old key). If you have the app open on
                                another device, request from there instead.
                            </span>

                            <div className="logout-actions">
                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() =>
                                        setConfirmFreshKey(false)
                                    }
                                >
                                    Cancel
                                </button>

                                <button
                                    type="button"
                                    className="btn-danger"
                                    onClick={handleRecoverCode}
                                    disabled={recoveryBusy}
                                >
                                    {recoveryBusy
                                        ? "Sending…"
                                        : "Request new key"}
                                </button>
                            </div>
                        </div>

                        {recoveryUnlockBox}

                    </div>

                ) : forceNewConfirm ? (

                    <div className="settings-actions">

                        <div className="logout-confirm">
                            <span>
                                This account already has synced history.
                                Creating a <strong>new account key</strong>{" "}
                                will permanently lock that history on{" "}
                                <strong>every</strong> browser — it cannot
                                be recovered, even with your old code.
                                <br />
                                <br />
                                You can still unlock the existing histories
                                by entering your current recovery code
                                below. Only choose &quot;Lock history
                                anyway&quot; if you are certain you no
                                longer need the old messages.
                            </span>

                            <div className="logout-actions">
                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() =>
                                        setForceNewConfirm(false)
                                    }
                                >
                                    Back
                                </button>

                                <button
                                    type="button"
                                    className="btn-danger"
                                    onClick={() =>
                                        handleRecoverCode(true)
                                    }
                                    disabled={recoveryBusy}
                                >
                                    {recoveryBusy
                                        ? "Sending…"
                                        : "Lock history anyway"}
                                </button>
                            </div>
                        </div>

                        {recoveryUnlockBox}

                    </div>

                ) : (

                    <div className="settings-actions">

                        {recoveryError && (
                            <p className="recovery-support-error">
                                {recoveryError}
                            </p>
                        )}

                        {recoveryCooldown > 0 ? (
                            <div className="recovery-support-timer">
                                <div
                                    className="recovery-timer-ring"
                                    style={{
                                        background:
                                            `conic-gradient(var(--accent) ` +
                                            `${(recoveryCooldown / 600) * 360}deg, ` +
                                            `rgba(127, 127, 127, 0.25) 0deg)`,
                                    }}
                                >
                                    <span>
                                        {formatCooldown(
                                            recoveryCooldown
                                        )}
                                    </span>
                                </div>

                                <div className="recovery-timer-text">
                                    {recoveryRemaining > 0
                                        ? `${recoveryRemaining} of 3 ` +
                                          "requests left this window " +
                                          `(resets in ${formatCooldown(
                                              recoveryCooldown
                                          )})`
                                        : "Limit reached — you can " +
                                          "request again when the " +
                                          "timer reaches zero"}
                                </div>
                            </div>
                        ) : null}

                        <button
                            type="button"
                            className="btn-primary settings-support-btn"
                            onClick={() => {

                                if (recoveryHasSecret) {

                                    handleRecoverCode();

                                }
                                else {

                                    setConfirmFreshKey(true);

                                }

                            }}
                            disabled={
                                recoveryBusy ||
                                (
                                    recoveryRemaining <= 0 &&
                                    recoveryCooldown > 0
                                )
                            }
                        >
                            {recoveryBusy
                                ? "Sending…"
                                : "Recover my recovery code"}
                        </button>

                        {!recoveryHasSecret && !confirmFreshKey && (
                            <p className="recovery-support-hint">
                                This browser hasn&apos;t unlocked the sync
                                secret, so requesting here creates a new
                                account key. Request from a browser that
                                already has your history to keep it intact.
                            </p>
                        )}

                        {recoveryUnlockBox}

                    </div>

                )}

            </section>

            <section className="settings-card">

                <div className="settings-card-head">

                    <h3>Legal</h3>

                    <p>
                        Read the Nexara privacy policy and terms of service.
                    </p>

                </div>

                <div className="settings-actions">
                    <div className="legal-links">
                        <Link to="/privacy">Privacy Policy</Link>
                        <Link to="/terms">Terms of Service</Link>
                    </div>
                </div>

            </section>

            <section className="settings-card danger-zone">

                <div className="settings-card-head">

                    <h3>Account</h3>

                    <p>
                        Log out or permanently delete your Nexara account.
                    </p>

                </div>

                <div className="settings-actions">

                    {confirmLogout ? (

                        <div className="logout-confirm">

                            <span>
                                Log out? Your secure keys on this
                                device will be removed.
                            </span>

                            <div className="logout-actions">

                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() =>
                                        setConfirmLogout(false)
                                    }
                                >
                                    Cancel
                                </button>

                                <button
                                    type="button"
                                    className="btn-danger"
                                    onClick={handleLogout}
                                >
                                    Log out
                                </button>

                            </div>

                        </div>

                    ) : (

                        <button
                            type="button"
                            className="btn-danger"
                            onClick={() =>
                                setConfirmLogout(true)
                            }
                        >
                            Log out
                        </button>

                    )}

                </div>

            </section>

        </div>

    );

}
