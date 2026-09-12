import api, {
    refreshAccessToken,
    setAccessToken,
    getAccessToken,
    clearAccessToken,
} from "../api/api";

import websocketService from "./websocketService";

const authService = {

    // ======================================================
    // Send OTP
    // ======================================================

    async sendOTP(email) {

        const response = await api.post(
            "/auth/send-otp",
            {
                email,
            }
        );

        return response.data;

    },

    // ======================================================
    // Verify OTP
    // ======================================================

    async verifyOTP(email, otp) {

        const response = await api.post(
            "/auth/verify-otp",
            {
                email,
                otp,
            }
        );

        return response.data;

    },

    // ======================================================
    // Refresh Access Token
    //
    // The refresh token lives in the HttpOnly cookie, which the
    // browser attaches automatically. Nothing is read from
    // localStorage and nothing is written back to it.
    // ======================================================

    async refreshAccessToken() {

        const token =
            await refreshAccessToken();

        return token;

    },

    // ======================================================
    // Two-step verification (2FA PIN)
    // ======================================================

    async getTwoFAStatus() {

        const response = await api.get(
            "/auth/two-fa/status"
        );

        return response.data;

    },

    async enableTwoFA(pin, confirmPin) {

        const response = await api.put(
            "/auth/two-fa",
            {
                pin,
                confirm_pin: confirmPin,
            }
        );

        return response.data;

    },

    async disableTwoFA(pin) {

        const response = await api.delete(
            "/auth/two-fa",
            {
                data: { pin },
            }
        );

        return response.data;

    },

    // Complete a login after the PIN challenge. The backend
    // returns the full TokenResponse, so the caller can log in
    // with it directly.
    async verifyTwoFA(twoFAToken, pin) {

        const response = await api.post(
            "/auth/two-fa/verify",
            {
                two_fa_token: twoFAToken,
                pin,
            }
        );

        return response.data;

    },

    // Recovery: prove control of the email with a fresh OTP to
    // turn 2FA off and log in (the "forgot my PIN" path).
    async resetTwoFA(email, otp) {

        const response = await api.post(
            "/auth/two-fa/reset",
            {
                email,
                otp,
            }
        );

        return response.data;

    },

    // ======================================================
    // Get Logged-in User
    // ======================================================

    async getCurrentUser() {

        const response = await api.get(
            "/users/me"
        );

        return response.data;

    },

    // ======================================================
    // Token Helpers (memory only)
    // ======================================================

    login(accessToken) {

        setAccessToken(accessToken);

    },

    getAccessToken() {

        return getAccessToken();

    },

    // ======================================================
    // User Helpers
    // ======================================================

    saveUser(user) {

        localStorage.setItem(
            "user",
            JSON.stringify(user),
        );

    },

    getStoredUser() {

        const user =
            localStorage.getItem("user");

        return user
            ? JSON.parse(user)
            : null;

    },

    // ======================================================
    // Load Current User From Backend
    // ======================================================

    async loadCurrentUser() {

        const user =
            await this.getCurrentUser();

        this.saveUser(user);

        return user;

    },

    // ======================================================
    // Logout
    //
    // Revokes the refresh-token family server-side (the cookie
    // travels along automatically) and clears local state.
    // ======================================================

    async logout() {

        try {

            await api.post(
                "/auth/logout",
                {},
            );

        }

        catch (error) {

            console.error(
                "Logout revocation failed:",
                error
            );

        }

        clearAccessToken();

        localStorage.removeItem(
            "user",
        );

        // A logged-out user must not keep an event stream open
        // (or auto-reconnect it): it would leak live activity and
        // the server would push messages into an unauthenticated UI.
        websocketService.disconnect();

    },

};

export default authService;