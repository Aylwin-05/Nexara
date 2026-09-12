"""Client-IP resolution with proxy-header hardening.

``X-Forwarded-For`` is only honored when the direct peer (the TCP
client that actually connected to us) is a loopback/private address
— i.e. a reverse proxy on our own network. Internet clients cannot
reach us directly through a trusted proxy, so a spoofed header from
them is ignored and the raw peer address is used instead. This keeps
IP-keyed rate limits honest when the application is exposed directly
(single origin, no proxy in front).
"""

import ipaddress

from fastapi import Request


def _is_private_or_loopback(peer: str) -> bool:
    try:
        addr = ipaddress.ip_address(peer)
    except ValueError:
        return False
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
    )


def resolve_client_ip(request: Request) -> str:
    """Return the client IP, honoring XFF only when the proxy is local."""

    peer = request.client.host if request.client else "unknown"

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and _is_private_or_loopback(peer):
        candidate = forwarded.split(",")[0].strip()
        try:
            ipaddress.ip_address(candidate)
            return candidate
        except ValueError:
            pass

    return peer