import { useEffect, useState } from "react";

import userService from "../services/userService";

export default function useUser() {
    const [user, setUser] = useState(null);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState(null);

    useEffect(() => {
        loadUser();
    }, []);

    async function loadUser() {
        try {
            setLoading(true);

            const data =
                await userService.getCurrentUser();

            setUser(data);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    return {
        user,
        loading,
        error,
        refresh: loadUser,
    };
}