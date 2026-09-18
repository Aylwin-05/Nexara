import { useNavigate } from "react-router-dom";

import Sidebar from "./Sidebar";

const PAGE_ROUTES = {
    chats: "/dashboard",
    status: "/dashboard",
    friends: "/dashboard",
    calls: "/calls",
    settings: "/settings",
};

export default function SidebarShell({ currentPage, children }) {
    const navigate = useNavigate();

    return (
        <div className="app-shell side-shell">
            <Sidebar
                currentPage={currentPage}
                setCurrentPage={(page) =>
                    navigate(PAGE_ROUTES[page] ?? "/dashboard")
                }
            />
            <div className="app-stage">{children}</div>
        </div>
    );
}