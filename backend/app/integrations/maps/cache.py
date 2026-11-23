"""Maps result caching (P2 §9.1, owner default #16: place ids indefinitely, coordinates/polylines 30 days).

:class:`MapsCache` is the storage interface. D3 implements the Firestore version in
``repositories/caches.py`` (collections ``geocodeCache`` / ``distanceCache`` / ``routeCache`` with a
TTL policy on ``expiresAt``); this module ships an in-memory implementation for tests and local use.

Keys are ``sha256`` of a normalised input, so no address text is stored in a document id.
Kinds and lifetimes:

======================  ===========================================  ===========
kind                    value                                        TTL
======================  ===========================================  ===========
``geocode``             ``GeocodedPlace.to_dict()``                  30 days
``place_ref``           ``{"place_id": ...}`` for a query/latlng     none (ids may be kept indefinitely)
``route``               ``RouteResult.to_dict()``                    30 days
``matrix``              ``{"d": metres|None, "t": seconds|None}``    30 days
======================  ===========================================  ===========
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Sequence
from datetime import timedelta
from typing import Any, Protocol

from .client import MapsClient
from .models import GeocodedPlace, LatLng, MatrixElement, RouteResult, Waypoint

COORDINATE_TTL = timedelta(days=30)


class MapsCache(Protocol):
    async def get(self, kind: str, key: str) -> dict[str, Any] | None: ...
    async def set(self, kind: str, key: str, value: dict[str, Any], ttl: timedelta | None) -> None: ...


class InMemoryMapsCache:
    def __init__(self) -> None:
        self._data: dict[tuple[str, str], tuple[float | None, dict[str, Any]]] = {}

    async def get(self, kind: str, key: str) -> dict[str, Any] | None:
        hit = self._data.get((kind, key))
        if hit is None:
            return None
        expires, value = hit
        if expires is not None and expires <= time.time():
            self._data.pop((kind, key), None)
            return None
        return value

    async def set(self, kind: str, key: str, value: dict[str, Any], ttl: timedelta | None) -> None:
        expires = time.time() + ttl.total_seconds() if ttl else None
        self._data[(kind, key)] = (expires, value)

    def __len__(self) -> int:
        return len(self._data)


def cache_key(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def normalise_query(query: str) -> str:
    return " ".join(query.lower().replace(",", " , ").split())


class CachingMapsClient:
    """Wraps any :class:`MapsClient` with a :class:`MapsCache`. Cache failures never fail a request."""

    def __init__(self, inner: MapsClient, cache: MapsCache) -> None:
        self.inner = inner
        self.cache = cache
        self.is_fake = inner.is_fake

    async def _get(self, kind: str, key: str) -> dict[str, Any] | None:
        try:
            return await self.cache.get(kind, key)
        except Exception:  # noqa: BLE001 - a broken cache must not break Maps
            return None

    async def _set(self, kind: str, key: str, value: dict[str, Any], ttl: timedelta | None) -> None:
        try:
            await self.cache.set(kind, key, value, ttl)
        except Exception:  # noqa: BLE001,S110
            pass

    async def _cached_place(self, ref_key: str, fetch: Any) -> GeocodedPlace:
        ref = await self._get("place_ref", ref_key)
        if ref and ref.get("place_id"):
            hit = await self._get("geocode", cache_key("place", ref["place_id"]))
            if hit:
                return GeocodedPlace.from_dict(hit)
        place: GeocodedPlace = await fetch()
        await self._set("geocode", cache_key("place", place.place_id), place.to_dict(), COORDINATE_TTL)
        await self._set("place_ref", ref_key, {"place_id": place.place_id}, None)
        return place

    async def geocode_address(self, query: str) -> GeocodedPlace:
        return await self._cached_place(
            cache_key("q", normalise_query(query)), lambda: self.inner.geocode_address(query)
        )

    async def geocode_place_id(self, place_id: str) -> GeocodedPlace:
        hit = await self._get("geocode", cache_key("place", place_id))
        if hit:
            return GeocodedPlace.from_dict(hit)
        place = await self.inner.geocode_place_id(place_id)
        await self._set("geocode", cache_key("place", place_id), place.to_dict(), COORDINATE_TTL)
        if place.place_id != place_id:  # Google may return a newer id for the same place
            await self._set("geocode", cache_key("place", place.place_id), place.to_dict(), COORDINATE_TTL)
        return place

    async def reverse_geocode(self, location: LatLng) -> GeocodedPlace:
        r = location.rounded(4)  # ~11 m
        return await self._cached_place(
            cache_key("ll", f"{r.lat:.4f},{r.lng:.4f}"), lambda: self.inner.reverse_geocode(location)
        )

    async def compute_route(self, stops: Sequence[Waypoint]) -> RouteResult:
        key = cache_key("route", *(s.key() for s in stops))
        hit = await self._get("route", key)
        if hit:
            return RouteResult.from_dict(hit)
        route = await self.inner.compute_route(stops)
        await self._set("route", key, route.to_dict(), COORDINATE_TTL)
        return route

    async def compute_route_matrix(
        self, origins: Sequence[Waypoint], destinations: Sequence[Waypoint]
    ) -> list[MatrixElement]:
        results: dict[tuple[int, int], MatrixElement] = {}
        missing_o: set[int] = set()
        missing_d: set[int] = set()
        for oi, o in enumerate(origins):
            for di, d in enumerate(destinations):
                hit = await self._get("matrix", cache_key("pair", o.key(), d.key()))
                if hit is None:
                    missing_o.add(oi)
                    missing_d.add(di)
                else:
                    results[(oi, di)] = MatrixElement(oi, di, hit.get("d"), hit.get("t"))
        if missing_o:
            o_idx, d_idx = sorted(missing_o), sorted(missing_d)
            fresh = await self.inner.compute_route_matrix([origins[i] for i in o_idx], [destinations[j] for j in d_idx])
            for e in fresh:
                oi, di = o_idx[e.origin_index], d_idx[e.destination_index]
                results[(oi, di)] = MatrixElement(oi, di, e.distance_m, e.duration_s)
                key = cache_key("pair", origins[oi].key(), destinations[di].key())
                await self._set("matrix", key, {"d": e.distance_m, "t": e.duration_s}, COORDINATE_TTL)
        return [results[k] for k in sorted(results)]


__all__ = [
    "COORDINATE_TTL",
    "CachingMapsClient",
    "InMemoryMapsCache",
    "MapsCache",
    "cache_key",
]
