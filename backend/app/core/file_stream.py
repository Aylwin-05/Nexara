"""Streaming file-save helpers.

Uploads are written to disk in bounded chunks instead of being
read fully into memory, so large files never balloon RAM.  The
size cap and empty-file checks happen *while* streaming, so an
over-large or empty payload is rejected before it is persisted.
"""

from __future__ import annotations

from pathlib import Path
from tempfile import NamedTemporaryFile

from app.core.magic_sniff import HEADER_SIZE, sniff_header
from fastapi import HTTPException, UploadFile

CHUNK = 64 * 1024


async def stream_to_disk(
    file: UploadFile,
    destination: Path,
    max_size: int,
    *,
    extension: str,
    sniff: bool = True,
) -> int:
    """Stream ``file`` into ``destination`` bounded by ``max_size``.

    Raises ``HTTPException`` (400/413) if the file is empty, exceeds
    ``max_size``, or its magic header does not match ``extension``.
    Returns the number of bytes written.

    Writes to a temp file in the same directory first, then atomically
    renames into place, so a mid-stream failure never leaves a
    half-written file at the final path.
    """

    header = b""

    size = 0

    with NamedTemporaryFile(
        mode="wb",
        dir=str(destination.parent),
        prefix=".upload-",
        delete=False,
    ) as tmp:
        while chunk := await file.read(CHUNK):
            size += len(chunk)

            if size > max_size:
                raise HTTPException(
                    status_code=413,
                    detail=(f"File is too large (max {max_size // (1024 * 1024)} MB)."),
                )

            if sniff and len(header) < HEADER_SIZE:
                header += chunk[: HEADER_SIZE - len(header)]

            tmp.write(chunk)

        if size == 0:
            raise HTTPException(
                status_code=400,
                detail="Empty file.",
            )

        if sniff and not sniff_header(extension, header):
            raise HTTPException(
                status_code=400,
                detail=("File content does not match its declared type."),
            )

        tmp.flush()
        tmp_path = Path(tmp.name)

    tmp_path.replace(destination)

    return size
