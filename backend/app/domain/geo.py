"""Geo helpers (P2 §9.2): haversine, geohash encode / neighbours, trip search keys. PURE. Owner: D3.

Search keys: every pickup-capable checkpoint (all but the last) publishes its geohash-4 cell and the
8 neighbours keyed with the IST date of its expected departure: ``"{gh4}|{YYYY-MM-DD}"``. A geohash-4
cell is ~39 × 19.5 km, so the 3 × 3 block covers every point within 19.5 km of the stop — which is
why ``serviceRadiusKm`` is capped at 15. Customer search runs one ``array_contains`` query with the
source's own cell and the shipping date.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from app.core.time import ist_date_of

_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
_DECODE = {c: i for i, c in enumerate(_BASE32)}
EARTH_RADIUS_KM = 6371.0088
SEARCH_PRECISION = 4


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(min(1.0, h)))


def distance_km(a: Mapping[str, Any], b: Mapping[str, Any]) -> float:
    """Haversine between two ``{lat, lng}`` maps."""
    return haversine_km(float(a["lat"]), float(a["lng"]), float(b["lat"]), float(b["lng"]))


def geohash_encode(lat: float, lng: float, precision: int = SEARCH_PRECISION) -> str:
    lat_lo, lat_hi, lng_lo, lng_hi = -90.0, 90.0, -180.0, 180.0
    out: list[str] = []
    bits, ch, even = 0, 0, True
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


def geohash_bounds(gh: str) -> tuple[float, float, float, float]:
    """``(lat_lo, lat_hi, lng_lo, lng_hi)`` of a cell."""
    lat_lo, lat_hi, lng_lo, lng_hi = -90.0, 90.0, -180.0, 180.0
    even = True
    for c in gh:
        v = _DECODE[c]
        for shift in range(4, -1, -1):
            bit = (v >> shift) & 1
            if even:
                mid = (lng_lo + lng_hi) / 2
                if bit:
                    lng_lo = mid
                else:
                    lng_hi = mid
            else:
                mid = (lat_lo + lat_hi) / 2
                if bit:
                    lat_lo = mid
                else:
                    lat_hi = mid
            even = not even
    return lat_lo, lat_hi, lng_lo, lng_hi


def geohash_neighbours(gh: str) -> list[str]:
    """The cell and its 8 neighbours (deduplicated near the poles / antimeridian), sorted."""
    lat_lo, lat_hi, lng_lo, lng_hi = geohash_bounds(gh)
    dlat, dlng = lat_hi - lat_lo, lng_hi - lng_lo
    clat, clng = (lat_lo + lat_hi) / 2, (lng_lo + lng_hi) / 2
    cells = set()
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            lat = clat + i * dlat
            lng = clng + j * dlng
            if lat > 90 or lat < -90:
                continue
            lng = ((lng + 180) % 360) - 180
            cells.add(geohash_encode(lat, lng, len(gh)))
    return sorted(cells)


def cell_of(location: Mapping[str, Any], precision: int = SEARCH_PRECISION) -> str:
    return geohash_encode(float(location["lat"]), float(location["lng"]), precision)


def search_key(cell: str, ist_date: str) -> str:
    return f"{cell}|{ist_date}"


def checkpoint_departure(cp: Mapping[str, Any]) -> datetime | None:
    return cp.get("expectedDepartureAt") or cp.get("expectedArrivalAt")


def search_keys(checkpoints: Iterable[Mapping[str, Any]]) -> list[str]:
    """``trip.searchKeys`` for published trips (≤ 81 strings), sorted. Stops without a location or a
    departure time are skipped."""
    cps = list(checkpoints)
    keys: set[str] = set()
    for cp in cps[:-1]:
        loc = (cp.get("place") or {}).get("location")
        dep = checkpoint_departure(cp)
        if not loc or dep is None:
            continue
        d = ist_date_of(dep).isoformat()
        for cell in geohash_neighbours(cell_of(loc)):
            keys.add(search_key(cell, d))
    return sorted(keys)


def search_key_for(location: Mapping[str, Any], ist_date: str) -> str:
    """The single key a customer search queries with (``array_contains``)."""
    return search_key(cell_of(location), ist_date)


__all__ = [
    "cell_of",
    "checkpoint_departure",
    "distance_km",
    "geohash_bounds",
    "geohash_encode",
    "geohash_neighbours",
    "haversine_km",
    "search_key",
    "search_key_for",
    "search_keys",
]
