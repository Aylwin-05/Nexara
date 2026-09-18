import api from "../api/api";

const friendService = {

    // ======================================================
    // Search Users
    // ======================================================

    async searchUsers(query) {

        const response = await api.get(
            `/friends/search?email=${encodeURIComponent(query)}`
        );

        return response.data;

    },

    // ======================================================
    // Friends List
    // ======================================================

    async getFriends() {

        const response = await api.get(
            "/friends/"
        );

        return response.data;

    },

    // ======================================================
    // Pending Requests
    // ======================================================

    async getPendingRequests() {

        const response = await api.get(
            "/friends/pending"
        );

        return response.data;

    },

    // ======================================================
    // Send Request
    // ======================================================

    async sendFriendRequest(receiverId) {

        const response = await api.post(
            "/friends/request",
            {
                receiver_id: receiverId,
            }
        );

        return response.data;

    },

    // ======================================================
    // Accept Request
    // ======================================================

    async acceptRequest(friendshipId) {

        const response = await api.post(
            "/friends/accept",
            {
                friendship_id: friendshipId,
            }
        );

        return response.data;

    },

    // ======================================================
    // Reject Request
    // ======================================================

    async rejectRequest(friendshipId) {

        const response = await api.post(
            "/friends/reject",
            {
                friendship_id: friendshipId,
            }
        );

        return response.data;

    },

    // ======================================================
    // Remove Friend
    // ======================================================

    async removeFriend(friendshipId) {

        const response = await api.delete(
            `/friends/${friendshipId}`
        );

        return response.data;

    },

};

export default friendService;