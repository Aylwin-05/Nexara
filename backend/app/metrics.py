import threading
import time
from collections import defaultdict

_start_time = time.monotonic()

_lock = threading.Lock()

_counters: dict[str, int] = defaultdict(int)

_gauges: dict[str, float] = {}


def inc_counter(name: str, value: int = 1) -> None:
    with _lock:
        _counters[name] += value


def set_gauge(name: str, value: float) -> None:
    with _lock:
        _gauges[name] = value


def get_snapshot() -> dict:
    uptime = round(time.monotonic() - _start_time, 2)
    with _lock:
        counters = dict(_counters)
        gauges = dict(_gauges)
    return {
        "uptime_seconds": uptime,
        "counters": counters,
        "gauges": gauges,
    }
