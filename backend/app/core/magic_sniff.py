# ==========================================================
# Magic-byte sniffing
#
# Uploads are validated against the SIGNATURE of their real
# content, not just the declared extension/content-type. A
# script disguised as "photo.jpg" no longer passes, because
# its bytes do not match any image signature.
#
# Every signature list is checked against the first bytes of
# the file; the first match wins. "Encrypted" uploads are
# ciphertext (random bytes) and are exempt — they are never
# served inline, so sniffing would only cause false rejects.
# ==========================================================

HEADER_SIZE = 16

SIGNATURES: dict[str, list[bytes]] = {
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".png": [b"\x89PNG\r\n\x1a\n"],
    ".gif": [b"GIF87a", b"GIF89a"],
    ".bmp": [b"BM"],
    ".mp4": [b"ftyp"],
    ".mov": [b"ftyp", b"moov"],
    ".mkv": [b"\x1aE\xdf\xa3"],
    ".webm": [b"\x1aE\xdf\xa3"],
    ".mp3": [b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"],
    ".aac": [b"\xff\xf1", b"\xff\xf9"],
    ".m4a": [b"ftyp"],
    ".ogg": [b"OggS"],
    ".opus": [b"OggS"],
    ".flac": [b"fLaC"],
    ".pdf": [b"%PDF-"],
    ".doc": [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"],
    ".ppt": [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"],
    ".xls": [b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"],
    ".docx": [b"PK\x03\x04", b"PK\x05\x06"],
    ".pptx": [b"PK\x03\x04", b"PK\x05\x06"],
    ".xlsx": [b"PK\x03\x04", b"PK\x05\x06"],
    ".zip": [b"PK\x03\x04", b"PK\x05\x06"],
    ".rar": [b"Rar!\x1a\x07"],
    ".7z": [b"7z\xbc\xaf\x27\x1c"],
}

TEXT_EXTENSIONS = {".txt"}

CIPHERTEXT_EXTENSIONS = {".bin"}

# Extensions that allow a signature at a known non-zero offset.
# Implemented as (offset, signature) checks on top of the
# simple prefix list above. Signature bytes may be shorter
# than HEADER_SIZE; they are compared at the given offset.
OFFSET_SIGNATURES: dict[str, list[tuple[int, bytes]]] = {
    ".webp": [(0, b"RIFF"), (8, b"WEBP")],
    ".avi": [(0, b"RIFF"), (8, b"AVI ")],
    ".wav": [(0, b"RIFF"), (8, b"WAVE")],
}


def sniff_header(
    extension: str,
    header: bytes,
) -> bool:
    """True when the file's first bytes match the extension's
    expected signature (or the extension needs no check)."""

    extension = extension.lower()

    if extension in TEXT_EXTENSIONS:
        return True

    if extension in CIPHERTEXT_EXTENSIONS:
        return True

    prefix_matches = SIGNATURES.get(extension, [])

    if not prefix_matches:
        # Unknown extension: the caller already rejected it via
        # detect_attachment_type; treat as unverifiable.
        return True

    if any(header.startswith(sig) for sig in prefix_matches):
        return True

    offset_matches = OFFSET_SIGNATURES.get(extension, [])

    if offset_matches and all(
        header[offset : offset + len(sig)] == sig for offset, sig in offset_matches
    ):
        return True

    return False
