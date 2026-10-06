import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConversationList from "./ConversationList";

const chatSocket = {
    presence: {},
    updateSettings: vi.fn(),
    conversationsError: null,
    refreshConversations: vi.fn(),
    conversationHasMore: false,
    conversationLoadingMore: false,
    loadMoreConversations: vi.fn(),
};

vi.mock("../../context/ChatSocketContext", () => ({
    useChatSocket: () => chatSocket,
}));

vi.mock("./ConversationItem", () => ({
    default: () => <div data-testid="conversation-item" />,
}));

function renderList(overrides = {}) {
    return render(
        <ConversationList
            conversations={[]}
            loading={false}
            selectedConversation={null}
            onSelectConversation={vi.fn()}
            {...overrides}
        />,
    );
}

describe("ConversationList", () => {
    it("shows the empty state when the server returned no conversations", () => {
        renderList();

        expect(
            screen.getByText("No conversations yet"),
        ).toBeTruthy();
    });

    it("shows a retry affordance instead of the empty state when the load failed", () => {
        chatSocket.conversationsError =
            "Cannot reach the server. Check your connection.";

        renderList();

        expect(screen.getByText("Couldn't load chats")).toBeTruthy();
        expect(
            screen.queryByText("No conversations yet"),
        ).toBeNull();

        fireEvent.click(
            screen.getByRole("button", { name: "Try again" }),
        );

        expect(chatSocket.refreshConversations).toHaveBeenCalled();

        chatSocket.conversationsError = null;
    });

    it("loads the next page when the user scrolls near the bottom", () => {
        chatSocket.conversationHasMore = true;

        const { container } = renderList();

        fireEvent.scroll(
            container.querySelector(".conv-list-body"),
            { target: { scrollTop: 1000 } },
        );

        expect(
            chatSocket.loadMoreConversations,
        ).toHaveBeenCalled();

        chatSocket.conversationHasMore = false;
    });
});
