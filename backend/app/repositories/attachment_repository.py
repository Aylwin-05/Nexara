from pathlib import Path
from uuid import UUID

from app.models.attachment import Attachment
from app.repositories.base_repository import BaseRepository
from sqlalchemy import select


class AttachmentRepository(BaseRepository):

    """
    Repository for Attachment CRUD operations.
    """

    # ==========================================================
    # Create
    # ==========================================================

    async def create_attachment(
        self,
        attachment: Attachment,
    ) -> Attachment:

        return await self.create(
            attachment
        )

    async def get_all_storage_filenames(
        self,
    ) -> set[str]:
        """Basenames of every attachment file the DB knows about."""

        result = await self.execute(
            select(Attachment.storage_path)
        )

        return {
            Path(path).name
            for (path,) in result.all()
        }

    # ==========================================================
    # Get By ID
    # ==========================================================

    async def get_by_id(
        self,
        attachment_id: UUID,
    ) -> Attachment | None:

        result = await self.execute(

            select(Attachment).where(

                Attachment.id == attachment_id

            )

        )

        return result.scalar_one_or_none()

    # ==========================================================
    # Get Message Attachments
    # ==========================================================

    async def get_by_message(
        self,
        message_id: UUID,
    ):

        result = await self.execute(

            select(Attachment)

            .where(
                Attachment.message_id == message_id
            )

        )

        return result.scalars().all()

    # ==========================================================
    # Delete
    # ==========================================================

    async def delete_attachment(
        self,
        attachment: Attachment,
    ):

        await self.delete(
            attachment
        )

    async def delete_attachments_for_message(
        self,
        message_id: UUID,
    ) -> list[tuple[str | None, str | None]]:
        """Hard-delete every attachment row of a message IN THE SAME
        TRANSACTION as the message deletion.

        Returns (storage_path, thumbnail_path) pairs so the caller
        can unlink the physical files AFTER the transaction commits
        (file loss on a rolled-back delete would corrupt a message
        that survived).
        """

        attachments = await self.get_by_message(message_id)

        paths = [
            (attachment.storage_path, attachment.thumbnail_path)
            for attachment in attachments
        ]

        for attachment in attachments:
            await self.db.delete(attachment)

        await self.db.flush()

        return paths
