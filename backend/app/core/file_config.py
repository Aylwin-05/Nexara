from pathlib import Path

# ==========================================================
# Base Upload Folder
# ==========================================================

BASE_UPLOAD_DIR = Path("uploads")


IMAGE_DIR = BASE_UPLOAD_DIR / "images"

VIDEO_DIR = BASE_UPLOAD_DIR / "videos"

DOCUMENT_DIR = BASE_UPLOAD_DIR / "documents"

AUDIO_DIR = BASE_UPLOAD_DIR / "audio"

VOICE_DIR = BASE_UPLOAD_DIR / "voice"

ARCHIVE_DIR = BASE_UPLOAD_DIR / "archives"

ENCRYPTED_DIR = BASE_UPLOAD_DIR / "encrypted"

THUMBNAIL_DIR = BASE_UPLOAD_DIR / "thumbnails"

AVATAR_DIR = BASE_UPLOAD_DIR / "avatars"

STORIES_DIR = BASE_UPLOAD_DIR / "stories"


# ==========================================================
# Maximum File Sizes
# ==========================================================

MAX_IMAGE_SIZE = 20 * 1024 * 1024

MAX_VIDEO_SIZE = 500 * 1024 * 1024

MAX_AUDIO_SIZE = 100 * 1024 * 1024

MAX_DOCUMENT_SIZE = 100 * 1024 * 1024

MAX_ARCHIVE_SIZE = 200 * 1024 * 1024

MAX_ENCRYPTED_SIZE = 500 * 1024 * 1024

MAX_AVATAR_SIZE = 5 * 1024 * 1024

MAX_STORY_SIZE = 20 * 1024 * 1024


# ==========================================================
# Allowed Extensions
# ==========================================================

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
}

VIDEO_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
}

AUDIO_EXTENSIONS = {
    ".mp3",
    ".wav",
    ".aac",
    ".ogg",
    ".flac",
}

VOICE_EXTENSIONS = {
    ".ogg",
    ".opus",
    ".m4a",
}

DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".txt",
}

ARCHIVE_EXTENSIONS = {
    ".zip",
    ".rar",
    ".7z",
}

ENCRYPTED_EXTENSIONS = {
    ".bin",
}

AVATAR_EXTENSIONS = IMAGE_EXTENSIONS

STORY_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

STORY_MEDIA_TYPES = {
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".gif": "image",
    ".bmp": "image",
    ".webp": "image",
    ".mp4": "video",
    ".mov": "video",
    ".avi": "video",
    ".mkv": "video",
    ".webm": "video",
}


# ==========================================================
# Create folders automatically
# ==========================================================

for directory in [

    BASE_UPLOAD_DIR,

    IMAGE_DIR,

    VIDEO_DIR,

    DOCUMENT_DIR,

    AUDIO_DIR,

    VOICE_DIR,

    ARCHIVE_DIR,

    ENCRYPTED_DIR,

    THUMBNAIL_DIR,

    AVATAR_DIR,

    STORIES_DIR,

]:
    directory.mkdir(
        parents=True,
        exist_ok=True,
    )
