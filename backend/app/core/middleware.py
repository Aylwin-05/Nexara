# ==========================================================
# Security middleware
# ==========================================================
import time
from collections import defaultdict

from fastapi import Request
from starlette.responses import JSONResponse

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": ("camera=(), microphone=(), geolocation=()"),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
}

CSP_HEADER = (
    "default-src 'self'; "
    "img-src 'self' data: blob:; "
    "media-src 'self' blob:; "
    "connect-src 'self' wss: ws:; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; "
    "font-src 'self' data:"
)


class SecurityHeadersMiddleware:
    """
    Adds hardening headers to every response.
    CSP stays modest so the SPA keeps working over the proxy.
    """

    def __init__(self, app, enable_csp: bool = True):
        self.app = app
        self.enable_csp = enable_csp

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = message.get("headers", [])
                headers = [(k.lower(), v) for (k, v) in headers]
                for name, value in SECURITY_HEADERS.items():
                    headers.append((name.lower().encode(), value.encode()))
                if self.enable_csp:
                    headers.append(
                        (
                            b"content-security-policy",
                            CSP_HEADER.encode(),
                        )
                    )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


class RequestIdMiddleware:
    """
    Give every request an ID, echo it back and log it.
    """

    def __init__(self, app, logger=None):
        self.app = app
        self.logger = logger

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)
        request_id = request.headers.get("x-request-id")
        if not request_id:
            import uuid

            request_id = uuid.uuid4().hex[:16]

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = message.get("headers", [])
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        if self.logger:
            self.logger.info(
                "%s %s -> request_id=%s",
                request.method,
                request.url.path,
                request_id,
            )

        await self.app(scope, receive, send_wrapper)


# ==========================================================
# Request body size limit (memory-DoS backstop)
# ==========================================================


class RequestBodySizeLimitMiddleware:
    """
    Rejects HTTP requests whose ``Content-Length`` exceeds the
    configured ceiling.  The rejection is immediate — no body
    bytes are consumed — so a malicious oversized JSON payload
    never reaches the application.

    File-upload routes already enforce per-type size caps via
    their own streamed checks; this middleware is a final
    defence-in-depth for endpoints that only accept small JSON
    bodies (auth, friends, messages, etc.).
    """

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_length = 0
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"content-length":
                try:
                    content_length = int(header_value)
                except (TypeError, ValueError):
                    content_length = 0
                break

        if content_length > self.max_bytes:
            response = JSONResponse(
                status_code=413,
                content={
                    "detail": "Request body too large.",
                },
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


# Global counters — reset on process restart.
_metrics = {
    "requests_total": 0,
    "errors_total": 0,
    "status_codes": defaultdict(int),
    "latencies_ms": [],
}
_MAX_LATENCY_SAMPLES = 1000


class MetricsMiddleware:
    """
    Lightweight request metrics.  Data is exposed via the
    ``/metrics`` endpoint (see ``app.main``).
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_code = 0

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 0)
            await send(message)

        await self.app(scope, receive, send_wrapper)

        elapsed_ms = (time.perf_counter() - start) * 1000

        _metrics["requests_total"] += 1
        _metrics["status_codes"][status_code] += 1
        if status_code >= 500:
            _metrics["errors_total"] += 1
        if len(_metrics["latencies_ms"]) < _MAX_LATENCY_SAMPLES:
            _metrics["latencies_ms"].append(round(elapsed_ms, 2))

        from app.metrics import inc_counter

        inc_counter("http_requests_total")
        inc_counter(f"http_requests_{status_code}")
        if status_code >= 400:
            inc_counter("http_errors_total")
            if status_code >= 500:
                route = getattr(scope.get("route"), "path", None) or scope.get("path", "unknown")
                inc_counter(f"http_errors_route:{route}")


def get_metrics():
    """Return a snapshot of the current metrics."""
    latencies = sorted(_metrics["latencies_ms"])
    n = len(latencies)
    return {
        "requests_total": _metrics["requests_total"],
        "errors_total": _metrics["errors_total"],
        "status_codes": dict(_metrics["status_codes"]),
        "latency": {
            "samples": n,
            "p50_ms": latencies[n // 2] if n else 0,
            "p95_ms": latencies[int(n * 0.95)] if n else 0,
            "p99_ms": latencies[int(n * 0.99)] if n else 0,
        },
    }
