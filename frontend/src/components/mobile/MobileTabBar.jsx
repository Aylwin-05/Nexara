import { useChatSocket } from "../../context/ChatSocketContext";

// ==========================================================
// Mobile bottom tab bar (WhatsApp-style placement).
//
// Desktop shows the left icon rail; on phones the same five
// destinations (Chats / Status / Friends / Calls / Settings) live in a
// fixed bottom bar. The bar is hidden while a conversation is
// open and shows the total unread count on the Chats tab.
//
// Visibility is handled in mobile.css:
//   • hidden above 720px (desktop keeps the rail)
//   • hidden inside a chat (.conv-item.active)
// ==========================================================

function ChatIcon({ active }) {
    return (
        <svg
            width="23"
            height="23"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
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
            width="23"
            height="23"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
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
            width="23"
            height="23"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
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
            width="23"
            height="23"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
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
            width="23"
            height="23"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

export default function MobileTabBar({
    currentPage,
    setCurrentPage,
}) {

    const socket = useChatSocket();

    if (!socket) return null;

    const totalUnread =
        (socket.conversations ?? []).reduce(
            (sum, conversation) =>
                sum + (conversation.unread_count ?? 0),
            0,
        );

    const tabs = [
        {
            key: "chats",
            label: "Chats",
            icon: ChatIcon,
            badge: totalUnread,
        },
        {
            key: "status",
            label: "Status",
            icon: StatusIcon,
        },
        {
            key: "friends",
            label: "Friends",
            icon: UsersIcon,
        },
        {
            key: "calls",
            label: "Calls",
            icon: CallsIcon,
        },
        {
            key: "settings",
            label: "Settings",
            icon: SettingsIcon,
        },
    ];

    return (

        <nav className="mobile-tab-bar" aria-label="Primary">

            {tabs.map((tab) => {

                const Icon = tab.icon;

                const active = currentPage === tab.key;

                return (
                    <button
                        key={tab.key}
                        type="button"
                        className={
                            active
                                ? "mobile-tab-btn active"
                                : "mobile-tab-btn"
                        }
                        onClick={() =>
                            setCurrentPage(tab.key)
                        }
                        aria-current={
                            active ? "page" : undefined
                        }
                    >
                        <Icon active={active} />
                        <span>{tab.label}</span>
                        {tab.badge > 0 && (
                            <span className="mobile-tab-badge">
                                {tab.badge > 99
                                    ? "99+"
                                    : tab.badge}
                            </span>
                        )}
                    </button>
                );
            })}

        </nav>

    );

}
