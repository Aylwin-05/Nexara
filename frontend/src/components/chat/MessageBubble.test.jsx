import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MessageBubble from "./MessageBubble";

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));
vi.mock("../../context/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("../../services/attachmentService", () => ({
    default: {
        getAttachment: vi.fn(async () => new Blob(["payload"])),
    },
}));
vi.mock("../../utils/animations", () => ({
    animateBubbleIn: vi.fn(),
    animateReactionPop: vi.fn(),
}));
vi.mock("./ImageLightbox", () => ({
    default: () => null,
}));

URL.createObjectURL = vi.fn(() => "blob:mock");
URL.revokeObjectURL = vi.fn();

const imageMessage = {
    id: "message-1",
    sender_id: "user-1",
    conversation_id: "conv-1",
    ciphertext: "{}",
    message_type: "text",
    created_at: "2026-10-06T00:00:00Z",
    updated_at: "2026-10-06T00:00:00Z",
    attachments: [
        {
            id: "attachment-1",
            attachment_type: "image",
            original_name: "photo.jpg",
            size: 2048,
        },
    ],
};

describe("MessageBubble image reveal", () => {
    it("shows a blurred download chip that reveals the image on tap", async () => {
        render(<MessageBubble message={{ ...imageMessage, content: "Hello" }} />);

        const wrapper = await screen.findByRole("button", {
            name: "Download image",
        });

        expect(
            screen.getByText(/Download/),
        ).toBeTruthy();

        fireEvent.click(wrapper);

        expect(
            await screen.findByRole("button", { name: "Open image" }),
        ).toBeTruthy();

        expect(screen.queryByText(/Download/)).toBeNull();
    });
});