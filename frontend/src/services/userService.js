import api from "../api/api";

const userService = {
    // ======================================================
    // Get Current User
    // ======================================================

    async getCurrentUser() {
        const response = await api.get("/users/me");
        return response.data;
    },

    // ======================================================
    // Update Profile (username / display name / bio / avatar)
    // ======================================================

    async updateProfile(payload) {
        const response = await api.patch("/users/me", payload);
        return response.data;
    },

    // ======================================================
    // Upload Avatar
    // ======================================================

    async uploadAvatar(file) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await api.post("/users/avatar", formData, {
            headers: { "Content-Type": "multipart/form-data" },
        });

        return response.data;
    },
};

export default userService;
