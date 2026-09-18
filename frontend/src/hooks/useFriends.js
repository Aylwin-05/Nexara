import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getApiErrorDetail } from "../utils/errors";
import friendService from "../services/friendService";

export default function useFriends() {

    const [friends, setFriends] =
        useState([]);

    const [pendingRequests, setPendingRequests] =
        useState([]);

    const [searchResults, setSearchResults] =
        useState([]);

    const [loading, setLoading] =
        useState(false);

    const [searching, setSearching] =
        useState(false);

    const [error, setError] =
        useState(null);

    // ======================================================
    // Initial Load
    // ======================================================

    useEffect(() => {

        loadData();

    }, []);

    async function loadData() {

        try {

            setLoading(true);

            const [

                friends,

                pending,

            ] = await Promise.all([

                friendService.getFriends(),

                friendService.getPendingRequests(),

            ]);

            setFriends(friends);

            setPendingRequests(pending);

        }

        catch (err) {

            console.error(err);

            setError(err);

            toast.error(getApiErrorDetail(err, "Unable to load friends."));

        }

        finally {

            setLoading(false);

        }

    }

    // ======================================================
    // Search Users
    // ======================================================

    async function searchUsers(query) {

        if (!query.trim()) {

            setSearchResults([]);

            return;

        }

        try {

            setSearching(true);

            const users =
                await friendService.searchUsers(query);

            setSearchResults(users);

        }

        catch (err) {

            console.error(err);

            setSearchResults([]);

            toast.error(getApiErrorDetail(err, "Unable to search users."));

        }

        finally {

            setSearching(false);

        }

    }

    // ======================================================
    // Send Friend Request
    // ======================================================

    async function sendFriendRequest(receiverId) {

        try {

            const response =
                await friendService.sendFriendRequest(
                    receiverId
                );

            toast.success(
                response.message ??
                "Friend request sent."
            );

            await loadData();

            return response;

        }

        catch (error) {

            console.error(error);

            toast.error(getApiErrorDetail(error, "Failed to send friend request."));

        }

    }

    // ======================================================
    // Accept Request
    // ======================================================

    async function acceptRequest(friendshipId) {

        try {

            const response =
                await friendService.acceptRequest(
                    friendshipId
                );

            toast.success(
                response.message ??
                "Friend request accepted."
            );

            await loadData();

        }

        catch (error) {

            console.error(error);

            toast.error(getApiErrorDetail(error, "Unable to accept request."));

        }

    }

    // ======================================================
    // Reject Request
    // ======================================================

    async function rejectRequest(friendshipId) {

        try {

            const response =
                await friendService.rejectRequest(
                    friendshipId
                );

            toast.success(
                response.message ??
                "Friend request rejected."
            );

            await loadData();

        }

        catch (error) {

            console.error(error);

            toast.error(getApiErrorDetail(error, "Unable to reject request."));

        }

    }

    // ======================================================
    // Remove Friend
    // ======================================================

    async function removeFriend(friendshipId) {

        try {

            const response =
                await friendService.removeFriend(
                    friendshipId
                );

            toast.success(
                response.message ??
                "Friend removed successfully."
            );

            await loadData();

        }

        catch (error) {

            console.error(error);

            toast.error(getApiErrorDetail(error, "Unable to remove friend."));

        }

    }

    return {

        friends,

        pendingRequests,

        searchResults,

        loading,

        searching,

        error,

        searchUsers,

        sendFriendRequest,

        acceptRequest,

        rejectRequest,

        removeFriend,

        refresh: loadData,

    };

}