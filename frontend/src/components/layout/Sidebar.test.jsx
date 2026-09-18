import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "./Sidebar";

const mockUser = {
    id: "user-1",
    display_name: "Test User",
};

vi.mock("../../hooks/useUser", () => ({
    default: () => ({ user: mockUser, loading: false }),
}));

vi.mock("../UserAvatar", () => ({
    default: () => <div data-testid="avatar" />,
}));

describe("Sidebar", () => {
    it("renders a Call History item that navigates to the calls page", () => {
        const setCurrentPage = vi.fn();

        render(
            <Sidebar
                currentPage="chats"
                setCurrentPage={setCurrentPage}
            />,
        );

        const callsButton = screen.getByRole("button", {
            name: "Call History",
        });

        expect(callsButton).toBeTruthy();

        fireEvent.click(callsButton);

        expect(setCurrentPage).toHaveBeenCalledWith("calls");
    });

    it("marks the Call History item as active on the calls page", () => {
        render(
            <Sidebar
                currentPage="calls"
                setCurrentPage={vi.fn()}
            />,
        );

        const callsButton = screen.getByRole("button", {
            name: "Call History",
        });

        expect(callsButton.className).toContain("active");
    });
});
