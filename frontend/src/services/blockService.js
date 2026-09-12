import api from "../api/api";

// ==========================================================
// Blocks & privacy — WhatsApp-style
//
// Blocking is directional: blocked users cannot message, call
// or see presence/stories/avatars of the blocker (the blocker
// stops seeing theirs too). Privacy settings control who may
// see your last-seen status, profile photo and stories.
// ==========================================================

async function blockUser(userId) {
    const response = await api.post("/blocks/", {
        user_id: userId,
    });
    return response.data;
}

async function unblockUser(userId) {
    const response = await api.delete(`/blocks/${userId}`);
    return response.data;
}

async function getBlockedUsers() {
    const response = await api.get("/blocks/");
    return response.data;
}

async function getPrivacy() {
    const response = await api.get("/blocks/privacy");
    return response.data;
}

async function updatePrivacy(patch) {
    const response = await api.patch("/blocks/privacy", patch);
    return response.data;
}

export default {
    blockUser,
    unblockUser,
    getBlockedUsers,
    getPrivacy,
    updatePrivacy,
};