export function messageSnippet(message) {
    if (!message) return "";

    if (message.deleted_for_everyone) {
        return "Message deleted";
    }

    if (message.content) {
        return message.content;
    }

    if (message.attachments?.length) {
        const attachment = message.attachments[0];
        const kinds = {
            image: "Photo",
            voice: "Voice message",
            audio: "Audio message",
            video: "Video message",
        };
        return kinds[attachment.attachment_type] ||
            attachment.original_name ||
            "Attachment";
    }

    return "";
}