import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

// Blocks auth pages while a session is active. Pressing the
// browser Back button from the dashboard lands on /login — this
// guard replaces that entry with /dashboard, so the auth flow
// can only ever be reached again through an explicit logout.
export default function PublicOnlyRoute({
    children,
}) {
    const {
        loading,
        isAuthenticated,
    } = useAuth();

    if (loading) {
        return (
            <div className="app-loading">
                <div className="spinner" />
                Loading your secure workspace…
            </div>
        );
    }

    if (isAuthenticated) {
        return (
            <Navigate
                to="/dashboard"
                replace
            />
        );
    }

    return children;
}