import api from "../api/api";

const keyService = {
    // ==========================================
    // Upload Public Key
    // ==========================================
    async uploadPublicKey(publicKey) {
        const response = await api.post(
            "/keys/public",
            {
                public_key: publicKey,
            }
        );

        return response.data;
    },

    // ==========================================
    // Get User Public Key
    // ==========================================
    async getPublicKey(userId) {
        const response = await api.get(
            `/keys/${userId}`
        );

        return response.data;
    },
};

export default keyService;