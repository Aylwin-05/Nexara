import api from "../api/api";

const deviceService = {

    // ======================================================
    // Register Device (with Signal key material)
    // ======================================================

    async registerDevice(payload) {

        const response = await api.post(
            "/devices/register",
            payload
        );

        return response.data;

    },

    // ======================================================
    // Get User Key Bundle (all devices, for X3DH)
    // ======================================================

    async getBundle(userId) {

        const response = await api.get(
            `/devices/${userId}/bundle`
        );

        return response.data;

    },

    // ======================================================
    // Upload Client-Generated One-Time PreKeys
    // ======================================================

    async uploadPreKeys(payload) {

        const response = await api.post(
            "/devices/prekeys/upload",
            payload
        );

        return response.data;

    },

    // ======================================================
    // List My Devices
    // ======================================================

    async listDevices() {

        const response = await api.get(
            "/devices/me"
        );

        return response.data;

    },

    // ======================================================
    // Remove Device
    // ======================================================

    async removeDevice(deviceId) {

        const response = await api.delete(
            `/devices/${deviceId}`
        );

        return response.data;

    },

};

export default deviceService;