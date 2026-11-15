"""Rate-limit helpers (P2 §5.8): Firestore-backed fixed windows shared by every instance.

* ``check(name, key, now)`` — call from services when the bucket key needs request data
  (e.g. ``login:phone:{e164}``).
* ``rate_limit(name, key_fn)`` — FastAPI dependency factory for routers.
* ``client_ip(request)`` — first ``X-Forwarded-For`` hop when ``TRUST_PROXY_HEADERS=true``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime

from fastapi import Request

from app.core.clock import get_clock
from app.core.config import get_settings
from app.core.constants import RATE_LIMITS
from app.repositories import rate_limits as repo

BUCKET_PREFIX = {
    "login_ip": "login:ip",
    "login_phone": "login:phone",
    "phone_proof_uid": "phone-proof:uid",
    "password_change_uid": "password:change:uid",
    "booking_create_uid": "booking:create:uid",
    "payment_create_uid": "payment:create:uid",
    "payment_verify_uid": "payment:verify:uid",
    "upload_uid": "upload:uid",
    "maps_uid": "maps:uid",
    "search_ip": "search:ip",
    "contact_ip": "contact:ip",
}


def client_ip(request: Request) -> str:
    if get_settings().TRUST_PROXY_HEADERS:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def check(name: str, key: str, now: datetime) -> None:
    """Count one hit on the named rule (P2 §5.8 table); raises 429 ``rate_limited`` on breach."""
    if not get_settings().RATE_LIMITS_ENABLED:
        return
    limit, window = RATE_LIMITS[name]
    await repo.hit(f"{BUCKET_PREFIX[name]}:{key}", limit, window, now)


def rate_limit(name: str, key_fn: Callable[[Request], str]) -> Callable[[Request], Awaitable[None]]:
    """``Depends(rate_limit("contact_ip", client_ip))``."""

    async def _dep(request: Request) -> None:
        await check(name, key_fn(request), get_clock().now())

    return _dep
