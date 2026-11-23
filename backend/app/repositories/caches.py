"""Firestore-backed Maps cache (P2 §9.1, owner default #16). Owner: D3.

Implements ``app.integrations.maps.MapsCache`` (``get(kind, key)`` / ``set(kind, key, value, ttl)``):

==============  ===================  =========================================
kind            collection           lifetime
==============  ===================  =========================================
``geocode``     ``geocodeCache``     30 days (``expiresAt``; TTL policy)
``place_ref``   ``geocodeCache``     indefinite (place ids may be kept)
``route``       ``routeCache``       30 days
``matrix``      ``distanceCache``    30 days
==============  ===================  =========================================

Document id = ``{kind}_{sha256 key}`` (no address text in ids). Expiry is also enforced on read, so
a missing TTL policy never serves stale coordinates. Installed at startup by ``install_maps_cache()``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from app.repositories.base import C, doc_ref

_COLLECTION = {
    "geocode": C.geocode_cache,
    "place_ref": C.geocode_cache,
    "route": C.route_cache,
    "matrix": C.distance_cache,
}


def _collection(kind: str) -> str:
    return _COLLECTION.get(kind, C.geocode_cache)


def _doc_id(kind: str, key: str) -> str:
    return f"{kind}_{key}"[:1500]


class FirestoreMapsCache:
    """Async, best-effort: ``CachingMapsClient`` swallows cache errors."""

    def __init__(self, clock: Any = None) -> None:
        self._clock = clock

    def _now(self) -> datetime:
        return self._clock.now() if self._clock is not None else datetime.now(UTC)

    async def get(self, kind: str, key: str) -> dict[str, Any] | None:
        snap = await doc_ref(_collection(kind), _doc_id(kind, key)).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        exp = data.get("expiresAt")
        if exp is not None and exp <= self._now():
            return None
        value = data.get("value")
        return value if isinstance(value, dict) else None

    async def set(self, kind: str, key: str, value: dict[str, Any], ttl: timedelta | None) -> None:
        now = self._now()
        await doc_ref(_collection(kind), _doc_id(kind, key)).set(
            {"kind": kind, "value": value, "createdAt": now, "expiresAt": now + ttl if ttl else None}
        )


def install_maps_cache() -> None:
    """Install the Firestore cache into D5's Maps integration (called from the app lifespan)."""
    from app.integrations.maps import configure_maps_cache

    configure_maps_cache(FirestoreMapsCache())
