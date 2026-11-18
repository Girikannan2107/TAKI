"""``PlaceResolver`` for ``app.deps.get_place_resolver`` (D2's protocol): Google place id → ``PlaceRef``.

``PlaceRef`` is the Firestore map embedded in addresses and checkpoints (P2 §6.2, camelCase)::

    {placeId, name, formattedAddress, location: {lat, lng}, locality, district,
     state, stateName, pincode, geohash, geocodedAt}

``geohash`` is precision 7 (display/debug only; matching keys are built by D3's ``domain/geo``).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .client import MapsClient
from .models import GeocodedPlace, LatLng

_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def geohash_encode(lat: float, lng: float, precision: int = 7) -> str:
    lat_lo, lat_hi, lng_lo, lng_hi = -90.0, 90.0, -180.0, 180.0
    out, bits, ch, even = [], 0, 0, True
    while len(out) < precision:
        if even:
            mid = (lng_lo + lng_hi) / 2
            if lng > mid:
                ch, lng_lo = (ch << 1) | 1, mid
            else:
                ch, lng_hi = ch << 1, mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat > mid:
                ch, lat_lo = (ch << 1) | 1, mid
            else:
                ch, lat_hi = ch << 1, mid
        even = not even
        bits += 1
        if bits == 5:
            out.append(_BASE32[ch])
            bits, ch = 0, 0
    return "".join(out)


def place_ref(place: GeocodedPlace, now: datetime | None = None) -> dict[str, Any]:
    return {
        "placeId": place.place_id,
        "name": place.name,
        "formattedAddress": place.formatted_address,
        "location": {"lat": place.lat, "lng": place.lng},
        "locality": place.locality,
        "district": place.district,
        "state": place.state_code,
        "stateName": place.state_name,
        "pincode": place.pincode,
        "geohash": geohash_encode(place.lat, place.lng, 7),
        "geocodedAt": now or datetime.now(UTC),
    }


def place_dto(place: GeocodedPlace) -> dict[str, Any]:
    """The API's ``PlaceDTO`` (camelCase JSON)."""
    return {
        "placeId": place.place_id,
        "name": place.name,
        "formattedAddress": place.formatted_address,
        "lat": place.lat,
        "lng": place.lng,
        "locality": place.locality,
        "district": place.district,
        "state": place.state_code or "",
        "stateName": place.state_name or "",
        "pincode": place.pincode,
    }


class MapsPlaceResolver:
    """Resolves lazily: ``maps_not_configured`` (503) is raised on use, not when the dependency is built."""

    def __init__(self, maps: MapsClient | None = None) -> None:
        self._maps = maps

    @property
    def maps(self) -> MapsClient:
        if self._maps is None:
            from . import get_maps

            self._maps = get_maps()
        return self._maps

    async def resolve_place_id(self, place_id: str) -> dict[str, Any]:
        return place_ref(await self.maps.geocode_place_id(place_id))

    async def resolve_address(self, query: str) -> dict[str, Any]:
        return place_ref(await self.maps.geocode_address(query))

    async def resolve_location(self, lat: float, lng: float) -> dict[str, Any]:
        return place_ref(await self.maps.reverse_geocode(LatLng(lat, lng)))


def get_place_resolver() -> MapsPlaceResolver:
    return MapsPlaceResolver()
