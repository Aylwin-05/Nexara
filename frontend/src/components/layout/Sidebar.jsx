import useUser from "../../hooks/useUser";
import UserAvatar from "../UserAvatar";

import "./Sidebar.css";

function ChatIcon({ active }) {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            {active && (
                <circle cx="9" cy="11.5" r="0.6" fill="currentColor" />
            )}
        </svg>
    );
}

function StatusIcon() {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
        >
            <circle cx="12" cy="12" r="9" strokeDasharray="3.6 3.2" />
            <circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none" />
        </svg>
    );
}

function UsersIcon() {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    );
}

function CallsIcon() {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

function SettingsIcon() {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

export default function Sidebar({

    currentPage,

    setCurrentPage,

}) {

    const {

        user,

        loading,

    } = useUser();

    return (

        <aside className="rail">

            <div className="rail-logo" title="Nexara">

                <svg
                    width="34"
                    height="34"
                    viewBox="0 0 32 32"
                    fill="none"
                >
                    <defs>
                        <linearGradient
                            id="railGrad"
                            x1="0"
                            y1="0"
                            x2="1"
                            y2="1"
                        >
                            <stop offset="0" stopColor="#7c5cff" />
                            <stop offset="1" stopColor="#22d3ee" />
                        </linearGradient>
                    </defs>
                    <path
                        d="M16 2l12 4v8c0 8-5 14-12 16C9 28 4 22 4 14V6z"
                        fill="url(#railGrad)"
                    />
                    <path
                        d="M12 13.5h8M12 17.5h5M12 21.5h8"
                        stroke="#fff"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                    />
                </svg>

            </div>

            <nav className="rail-nav">

                <button
                    type="button"
                    className={
                        currentPage === "chats"
                            ? "rail-item active"
                            : "rail-item"
                    }
                    onClick={() =>
                        setCurrentPage("chats")
                    }
                    title="Chats"
                >
                    <ChatIcon active={currentPage === "chats"} />
                    <span>Chats</span>
                </button>

                <button
                    type="button"
                    className={
                        currentPage === "status"
                            ? "rail-item active"
                            : "rail-item"
                    }
                    onClick={() =>
                        setCurrentPage("status")
                    }
                    title="Status"
                >
                    <StatusIcon />
                    <span>Status</span>
                </button>

                <button
                    type="button"
                    className={
                        currentPage === "friends"
                            ? "rail-item active"
                            : "rail-item"
                    }
                    onClick={() =>
                        setCurrentPage("friends")
                    }
                    title="Friends"
                >
                    <UsersIcon />
                    <span>Friends</span>
                </button>

                <button
                    type="button"
                    className={
                        currentPage === "calls"
                            ? "rail-item active"
                            : "rail-item"
                    }
                    onClick={() =>
                        setCurrentPage("calls")
                    }
                    title="Calls"
                >
                    <CallsIcon />
                    <span>Call History</span>
                </button>

                <button
                    type="button"
                    className={
                        currentPage === "settings"
                            ? "rail-item active"
                            : "rail-item"
                    }
                    onClick={() =>
                        setCurrentPage("settings")
                    }
                    title="Settings"
                >
                    <SettingsIcon />
                    <span>Settings</span>
                </button>

            </nav>

            <div className="rail-profile" title="Your profile">

                {loading ? (

                    <div className="skeleton rail-avatar-skeleton" />

                ) : (

                    <UserAvatar
                        user={user}
                        className="rail-avatar"
                    />

                )}

            </div>

        </aside>

    );

}