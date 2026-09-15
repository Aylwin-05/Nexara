import mimetypes
import shutil
import time
from pathlib import Path
from uuid import UUID, uuid4

from app.core.file_config import (
    ARCHIVE_DIR,
    ARCHIVE_EXTENSIONS,
    AUDIO_DIR,
    AUDIO_EXTENSIONS,
    DOCUMENT_DIR,
    DOCUMENT_EXTENSIONS,
    ENCRYPTED_DIR,
    ENCRYPTED_EXTENSIONS,
    IMAGE_DIR,
    IMAGE_EXTENSIONS,
    MAX_ARCHIVE_SIZE,
    MAX_AUDIO_SIZE,
    MAX_DOCUMENT_SIZE,
    MAX_ENCRYPTED_SIZE,
    MAX_IMAGE_SIZE,
    MAX_VIDEO_SIZE,
    VIDEO_DIR,
    VIDEO_EXTENSIONS,
    VOICE_DIR,
    VOICE_EXTENSIONS,
)
from app.core.magic_sniff import (
    HEADER_SIZE,
    sniff_header,
)
from app.models.attachment import Attachment
from app.repositories.attachment_repository import AttachmentRepository
from fastapi import HTTPException, UploadFile


class AttachmentService:
    """
    Handles every file upload inside Nexara.

    Responsibilities
    ----------------
    ✔ Validate uploads
    ✔ Detect attachment type
    ✔ Generate secure filenames
    ✔ Save files
    ✔ Store metadata

    Future

    ✔ Virus Scan
    ✔ Encryption
    ✔ Thumbnail Generation
    ✔ Cloud Storage
    """

    def __init__(
        self,
        repository: AttachmentRepository,
    ):

        self.repository = repository

    # ==========================================================
    # Detect Attachment Type
    # ==========================================================

    def detect_attachment_type(
        self,
        extension: str,
        mime_type: str,
    ) -> str:

        extension = extension.lower()

        if extension in IMAGE_EXTENSIONS:
            return "image"

        if extension in VIDEO_EXTENSIONS:
            return "video"

        if extension in AUDIO_EXTENSIONS or extension in VOICE_EXTENSIONS:
            return "audio"

        if extension in DOCUMENT_EXTENSIONS:
            return "document"

        if extension in ARCHIVE_EXTENSIONS:
            return "archive"

        if extension in ENCRYPTED_EXTENSIONS:
            return "encrypted"

        raise HTTPException(
            status_code=400,
            detail="Unsupported file type.",
        )

    # ==========================================================
    # Detect Upload Folder
    # ==========================================================

    def upload_directory(
        self,
        attachment_type: str,
    ) -> Path:

        mapping = {
            "image": IMAGE_DIR,
            "video": VIDEO_DIR,
            "audio": AUDIO_DIR,
            "voice": VOICE_DIR,
            "document": DOCUMENT_DIR,
            "archive": ARCHIVE_DIR,
            "encrypted": ENCRYPTED_DIR,
        }

        return mapping[attachment_type]

    # ==========================================================
    # Max File Size
    # ==========================================================

    def max_allowed_size(
        self,
        attachment_type: str,
    ) -> int:

        mapping = {
            "image": MAX_IMAGE_SIZE,
            "video": MAX_VIDEO_SIZE,
            "audio": MAX_AUDIO_SIZE,
            "voice": MAX_AUDIO_SIZE,
            "document": MAX_DOCUMENT_SIZE,
            "archive": MAX_ARCHIVE_SIZE,
            "encrypted": MAX_ENCRYPTED_SIZE,
        }

        return mapping[attachment_type]

        # ==========================================================

    # Generate Secure Filename
    # ==========================================================

    def generate_filename(
        self,
        extension: str,
    ) -> str:

        return f"{uuid4().hex}{extension.lower()}"

    # ==========================================================
    # Validate Upload
    # ==========================================================

    async def validate_file(
        self,
        file: UploadFile,
        encrypted: bool = False,
    ) -> tuple[str, str, int]:

        if not file.filename:
            raise HTTPException(
                status_code=400,
                detail="Invalid filename.",
            )

        extension = Path(file.filename).suffix.lower()

        mime_type = file.content_type or "application/octet-stream"

        attachment_type = self.detect_attachment_type(
            extension,
            mime_type,
        )

        size = 0

        header = b""

        while chunk := await file.read(64 * 1024):
            size += len(chunk)

            if len(header) < HEADER_SIZE:
                header += chunk[: HEADER_SIZE - len(header)]

        await file.seek(0)

        # The extension is only a claim: the actual bytes must
        # match. Encrypted uploads are ciphertext (random bytes)
        # and exempt — they are never served inline, so sniffing
        # would only cause false rejects.
        if not encrypted and not sniff_header(
            extension,
            header,
        ):
            raise HTTPException(
                status_code=400,
                detail=("File content does not match its declared type."),
            )

        max_size = self.max_allowed_size(attachment_type)

        if size > max_size:
            raise HTTPException(
                status_code=400,
                detail=(f"Maximum allowed size is {max_size // (1024 * 1024)} MB."),
            )

        return (
            extension,
            attachment_type,
            size,
        )

    # ==========================================================
    # Save File To Disk
    # ==========================================================

    async def save_file(
        self,
        file: UploadFile,
        attachment_type: str,
        extension: str,
    ) -> tuple[str, str]:

        filename = self.generate_filename(extension)

        upload_directory = self.upload_directory(attachment_type)

        upload_directory.mkdir(
            parents=True,
            exist_ok=True,
        )

        destination = upload_directory / filename

        with destination.open("wb") as buffer:
            shutil.copyfileobj(
                file.file,
                buffer,
            )

        return (
            filename,
            str(destination),
        )

    # ==========================================================
    # Guess MIME Type
    # ==========================================================

    def detect_mime_type(
        self,
        filename: str,
    ) -> str:

        mime_type, _ = mimetypes.guess_type(filename)

        return mime_type or "application/octet-stream"

    # ==========================================================
    # Upload Attachment
    # ==========================================================

    async def upload_attachment(
        self,
        message_id: UUID,
        file: UploadFile,
        encrypted: bool = False,
        encrypted_key_sender: str | None = None,
        encrypted_key_receiver: str | None = None,
        nonce: str | None = None,
        wrapped_keys: list | None = None,
        view_once: bool = False,
    ) -> Attachment:

        extension, attachment_type, size = await self.validate_file(
            file,
            encrypted=encrypted,
        )

        filename = None
        storage_path = None

        try:
            filename, storage_path = await self.save_file(
                file,
                attachment_type,
                extension,
            )

            mime_type = self.detect_mime_type(filename)

            attachment = Attachment(
                message_id=message_id,
                original_name=file.filename,
                filename=filename,
                mime_type=mime_type,
                extension=extension,
                attachment_type=attachment_type,
                size=size,
                storage_path=storage_path,
                encrypted=encrypted,
                encrypted_key_sender=encrypted_key_sender,
                encrypted_key_receiver=encrypted_key_receiver,
                nonce=nonce,
                wrapped_keys=wrapped_keys,
                view_once=view_once,
            )

            return await self.repository.create_attachment(attachment)

        except Exception:
            if storage_path:
                path = Path(storage_path)

                if path.exists():
                    path.unlink()

            raise

    # ==========================================================
    # Sweep Orphaned Files
    # ==========================================================

    ATTACHMENT_DIRS = (
        IMAGE_DIR,
        VIDEO_DIR,
        AUDIO_DIR,
        VOICE_DIR,
        DOCUMENT_DIR,
        ARCHIVE_DIR,
        ENCRYPTED_DIR,
    )

    async def sweep_orphaned_files(
        self,
        min_age_seconds: int = 3600,
    ) -> int:
        """Delete files in upload dirs with no Attachment row.

        Covers uploads abandoned between the disk write and the DB
        commit (client abort, crash, killed process). ``min_age``
        keeps a freshly-written file whose row is about to commit
        out of harm's way: the sweep only touches files older than
        the threshold, and the commit happens well within a second
        of the write.
        """

        known = await self.repository.get_all_storage_filenames()

        removed = 0

        now = time.time()

        for directory in self.ATTACHMENT_DIRS:
            if not directory.is_dir():
                continue

            for path in directory.iterdir():
                if not path.is_file():
                    continue

                try:
                    is_stale = path.stat().st_mtime < now - min_age_seconds
                except OSError:
                    continue

                if is_stale and path.name not in known:
                    try:
                        path.unlink()
                    except OSError:
                        continue

                    removed += 1

        return removed

    async def delete_attachments_for_message(
        self,
        message_id: UUID,
    ) -> list[tuple[str | None, str | None]]:
        """Hard-delete a message's attachment rows (same txn as the
        message delete) and hand the file paths to the caller for
        post-commit unlink."""

        return await self.repository.delete_attachments_for_message(message_id)

    # ==========================================================
    # Get Attachment
    # ==========================================================

    async def get_attachment(
        self,
        attachment_id: UUID,
    ) -> Attachment | None:

        return await self.repository.get_by_id(attachment_id)

    # ==========================================================
    # Delete Attachment
    # ==========================================================

    async def delete_attachment(
        self,
        attachment_id: UUID,
    ) -> bool:

        attachment = await self.get_attachment(attachment_id)

        if attachment is None:
            return False

        path = Path(attachment.storage_path)

        if path.exists():
            path.unlink()

        await self.repository.delete_attachment(attachment)

        return True

    # ==========================================================
    # Get Attachment File Path
    # ==========================================================

    def get_file_path(
        self,
        attachment: Attachment,
    ) -> Path:
        """
        Returns the physical file path.
        """

        return Path(attachment.storage_path)

    # ==========================================================
    # Check File Exists
    # ==========================================================

    def file_exists(
        self,
        attachment: Attachment,
    ) -> bool:
        """
        Returns whether the file exists.
        """

        return self.get_file_path(attachment).exists()

    # ==========================================================
    # Future Encryption Hook
    # ==========================================================

    async def encrypt_file(
        self,
        attachment: Attachment,
    ):
        """
        Placeholder.

        Phase 2:
        Encrypt uploaded files using
        recipient public keys.
        """

        return attachment

    # ==========================================================
    # Future Decryption Hook
    # ==========================================================

    async def decrypt_file(
        self,
        attachment: Attachment,
    ):
        """
        Placeholder.

        Phase 2:
        Decrypt before download.
        """

        return attachment

    # ==========================================================
    # Future Thumbnail Hook
    # ==========================================================

    async def generate_thumbnail(
        self,
        attachment: Attachment,
    ):
        """
        Placeholder.

        Future support:

        • Images
        • Videos
        • PDFs
        """

        return None

    # ==========================================================
    # Human Readable Size
    # ==========================================================

    def readable_size(
        self,
        size: int,
    ) -> str:

        units = [
            "B",
            "KB",
            "MB",
            "GB",
            "TB",
        ]

        value = float(size)

        for unit in units:
            if value < 1024:
                return f"{value:.2f} {unit}"

            value /= 1024

        return f"{value:.2f} PB"
