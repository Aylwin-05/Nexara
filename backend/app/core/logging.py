import json
import logging
import sys
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    """
    Structured (JSON-lines) formatter: machine-readable logs for
    collection pipelines, with the human detail still present.
    """

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def setup_logging(level: str | None = None, json_output: bool = True):
    if level is None:
        from app.core.config import settings

        level = settings.LOG_LEVEL
    root = logging.getLogger()
    root.setLevel(level.upper())

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter()
        if json_output
        else logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )

    root.handlers[:] = [handler]

    for noisy in (
        "httpx",
        "multipart",
        "sqlalchemy.engine",
        "sqlalchemy.engine.Engine",
        # NOTE: "uvicorn.access" is deliberately NOT silenced here.
        # Developers rely on the per-request access lines to see live
        # traffic (and the [DEV] OTP print) in the terminal. Add it
        # back only if request-line noise becomes a problem.
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return root
