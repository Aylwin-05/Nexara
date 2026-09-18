import api, { getConfiguredServer } from "../api/api";

const conversationService = {

    //==========================================================
    // Get All Conversations
    //==========================================================

    async getConversations() {

        try {

            const response = await api.get(
                "/conversations/"
            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to load conversations",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Create or Open Private Conversation
    //==========================================================

    async createPrivateConversation(
        userId,
    ) {

        try {

            const response = await api.post(

                "/conversations/private",

                {

                    user_id: userId,

                }

            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to create conversation",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Create Group
    //==========================================================

    async createGroup(name, memberIds) {

        try {

            const response = await api.post(

                "/conversations/group",

                {

                    name,

                    member_ids: memberIds,

                }

            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to create group",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Get Conversation Detail (group participants + keys)
    //==========================================================

    async getConversation(conversationId) {

        try {

            const response = await api.get(
                `/conversations/${conversationId}`
            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to load conversation detail",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Add Group Members (admin only)
    //==========================================================

    async addGroupMembers(conversationId, memberIds) {

        try {

            const response = await api.post(

                `/conversations/${conversationId}/group/add`,

                {

                    member_ids: memberIds,

                }

            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to add group members",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Leave Group
    //==========================================================

    async leaveGroup(conversationId) {

        try {

            const response = await api.post(
                `/conversations/${conversationId}/group/leave`
            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to leave group",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Update Group Info (name / description, admin only)
    //==========================================================

    async updateGroup(conversationId, fields) {

        try {

            const response = await api.patch(
                `/conversations/${conversationId}/group`,
                fields,
            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to update group",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Remove Group Member (admin only)
    //==========================================================

    async removeGroupMember(conversationId, userId) {

        try {

            const response = await api.post(
                `/conversations/${conversationId}/group/remove`,
                { user_id: userId },
            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to remove group member",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Promote / Demote Admin (admin only)
    //==========================================================

    async setGroupAdmin(conversationId, userId, isAdmin) {

        try {

            const response = await api.post(
                `/conversations/${conversationId}/group/admin`,
                { user_id: userId, is_admin: isAdmin },
            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to change admin role",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Upload Group Avatar (admin only)
    //==========================================================

    async uploadGroupAvatar(conversationId, file) {

        try {

            const formData = new FormData();

            formData.append("file", file);

            const response = await api.post(
                `/conversations/${conversationId}/avatar`,
                formData,
                {
                    headers: {
                        "Content-Type": "multipart/form-data",
                    },
                },
            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to upload group avatar",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Group Avatar URL (participants only)
    //==========================================================

    avatarUrl(conversationId) {

        return `${getConfiguredServer()}/api/v1/conversations/${conversationId}/avatar`;

    },

    //==========================================================
    // Update Conversation Settings (pin / archive / mute)
    //==========================================================

    async updateSettings(
        conversationId,
        settings,
    ) {

        try {

            const response = await api.patch(

                `/conversations/${conversationId}`,

                settings,

            );

            return response.data;

        }

        catch (error) {

            console.error(
                "Failed to update conversation settings",
                error
            );

            throw error;

        }

    },

    //==========================================================
    // Request Conversation Deletion (two-party consent)
    //
    // User 1 requests the wipe; the OTHER participant must
    // confirm (delete-confirm) before anything is erased.
    //==========================================================

    async requestDelete(conversationId) {

        const response = await api.post(
            `/conversations/${conversationId}/delete-request`
        );

        return response.data;

    },

    //==========================================================
    // Confirm Conversation Deletion
    //
    // The second participant consents; the server then purges
    // every message + attachment + the conversation itself.
    //==========================================================

    async confirmDelete(conversationId) {

        const response = await api.post(
            `/conversations/${conversationId}/delete-confirm`
        );

        return response.data;

    },

    //==========================================================
    // Cancel a Pending Deletion Request
    //
    // The requester can withdraw their request; the other
    // participant can dismiss it ("Not now").
    //==========================================================

    async cancelDelete(conversationId) {

        const response = await api.post(
            `/conversations/${conversationId}/delete-cancel`
        );

        return response.data;

    },

    //==========================================================
    // Get Active Invite Link (group admin only)
    //==========================================================

    async getInviteLink(conversationId) {

        const response = await api.get(
            `/conversations/${conversationId}/group/invite-link`
        );

        return response.data;

    },

    //==========================================================
    // Create / Reset Invite Link (group admin only)
    //==========================================================

    async createInviteLink(conversationId) {

        const response = await api.post(
            `/conversations/${conversationId}/group/invite-link`
        );

        return response.data;

    },

    //==========================================================
    // Revoke Invite Link (group admin only)
    //==========================================================

    async revokeInviteLink(conversationId) {

        const response = await api.delete(
            `/conversations/${conversationId}/group/invite-link`
        );

        return response.data;

    },

    //==========================================================
    // Join a Group by Redeeming an Invite Link
    //==========================================================

    async joinGroupWithLink(token) {

        const response = await api.post(
            "/conversations/join-with-link",
            { token },
        );

        return response.data;

    },
};

export default conversationService;