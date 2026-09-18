import multiprocessing
import os

workers = int(
    os.environ.get(
        "WEB_CONCURRENCY",
        multiprocessing.cpu_count(),
    )
)

worker_class = "uvicorn.workers.UvicornWorker"
bind = "0.0.0.0:8000"
forwarded_allow_ips = os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1")
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("LOG_LEVEL", "info").lower()
keepalive = 30
graceful_timeout = 30
timeout = 120
