"""Google Maps Platform client (server key; P2 §9.1). Owner: D5.

APIs used:
- Geocoding API (``/maps/api/geocode/json``): forward (``address`` + ``components=country:IN``),
  by ``place_id`` and reverse (``latlng`` + ``result_type``).
- Routes API ``computeRoutes`` (trip legs, durations, encoded polylines; intermediates are stopovers).
- Routes API ``computeRouteMatrix`` (road distances for matching), chunked to Google's limits.

Errors are mapped to domain errors: no result → 422 ``address_not_found``; quota, denied key,
timeouts and 5xx → 502 ``maps_unavailable`` (``details.reason``). GETs and the read-only Routes
POSTs are retried on timeouts / 5xx (they have no side effects). The key never appears in logs.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from typing import Any, Protocol

import httpx

from .errors import AddressNotFound, MapsUnavailable
from .models import GeocodedPlace, LatLng, MatrixElement, RouteLeg, RouteResult, Waypoint, state_code_for

log = logging.getLogger("taki.maps")

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"

ROUTES_FIELD_MASK = (
    "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,"
    "routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline"
)
MATRIX_FIELD_MASK = "originIndex,destinationIndex,status,condition,distanceMeters,duration"
REVERSE_RESULT_TYPES = "street_address|premise|route|sublocality|locality"

MAX_INTERMEDIATES = 25
MATRIX_MAX_ELEMENTS = 625  # TRAFFIC_UNAWARE limit
MATRIX_MAX_WAYPOINTS = 50  # origins + destinations per request
RETRIES = 2
RETRY_BACKOFF_SECONDS = 0.3

_QUOTA = {"OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT", "RESOURCE_EXHAUSTED"}
_DENIED = {"REQUEST_DENIED", "PERMISSION_DENIED", "UNAUTHENTICATED"}


class MapsClient(Protocol):
    """What D3 (trip routes) and D4 (addresses, matching) call through ``get_maps()``."""

    is_fake: bool

    async def geocode_address(self, query: str) -> GeocodedPlace: ...
    async def geocode_place_id(self, place_id: str) -> GeocodedPlace: ...
    async def reverse_geocode(self, location: LatLng) -> GeocodedPlace: ...
    async def compute_route(self, stops: Sequence[Waypoint]) -> RouteResult: ...
    async def compute_route_matrix(
        self, origins: Sequence[Waypoint], destinations: Sequence[Waypoint]
    ) -> list[MatrixElement]: ...


# ── parsing helpers (pure; unit-tested) ──────────────────────────────────────────────────────


def parse_geocode_result(result: dict[str, Any]) -> GeocodedPlace:
    comps: dict[str, dict[str, Any]] = {}
    for c in result.get("address_components", []):
        for t in c.get("types", []):
            comps.setdefault(t, c)

    def long(t: str) -> str | None:
        c = comps.get(t)
        return str(c["long_name"]) if c else None

    state = comps.get("administrative_area_level_1")
    country = comps.get("country")
    locality = long("locality") or long("sublocality") or long("sublocality_level_1") or long("postal_town")
    district = long("administrative_area_level_3") or long("administrative_area_level_2")
    types = tuple(result.get("types", []))
    name = (
        long("premise")
        or long("point_of_interest")
        or long("establishment")
        or (long("route") if "route" in types or "street_address" in types else None)
        or locality
        or district
        or str(result.get("formatted_address", "")).split(",")[0]
    )
    loc = result.get("geometry", {}).get("location", {})
    return GeocodedPlace(
        place_id=str(result["place_id"]),
        name=name,
        formatted_address=str(result.get("formatted_address", "")),
        lat=float(loc["lat"]),
        lng=float(loc["lng"]),
        locality=locality,
        district=district,
        state_code=state_code_for(state["long_name"], state.get("short_name")) if state else None,
        state_name=str(state["long_name"]) if state else None,
        pincode=long("postal_code"),
        country_code=str(country["short_name"]).upper() if country else None,
        types=types,
    )


def _duration_s(value: Any) -> int:
    """Routes durations are strings like ``"1234s"`` (or ``"12.5s"``)."""
    if value is None:
        return 0
    s = str(value).rstrip("s")
    try:
        return round(float(s))
    except ValueError:
        return 0


def parse_route(body: dict[str, Any], stop_count: int) -> RouteResult:
    routes = body.get("routes") or []
    if not routes:
        raise AddressNotFound()  # no drivable route between the stops
    r = routes[0]
    legs = tuple(
        RouteLeg(
            index=i,
            distance_m=int(leg.get("distanceMeters", 0)),
            duration_s=_duration_s(leg.get("duration")),
            polyline=str((leg.get("polyline") or {}).get("encodedPolyline", "")),
        )
        for i, leg in enumerate(r.get("legs", []))
    )
    if len(legs) != stop_count - 1:
        raise MapsUnavailable("upstream")
    return RouteResult(
        distance_m=int(r.get("distanceMeters", sum(leg.distance_m for leg in legs))),
        duration_s=_duration_s(r.get("duration")) or sum(leg.duration_s for leg in legs),
        polyline=str((r.get("polyline") or {}).get("encodedPolyline", "")),
        legs=legs,
    )


def parse_matrix(items: list[dict[str, Any]], origin_offset: int = 0, dest_offset: int = 0) -> list[MatrixElement]:
    out = []
    for it in items:
        ok = it.get("condition") == "ROUTE_EXISTS" and not (it.get("status") or {}).get("code")
        out.append(
            MatrixElement(
                origin_index=int(it.get("originIndex", 0)) + origin_offset,  # proto3 omits zero indices
                destination_index=int(it.get("destinationIndex", 0)) + dest_offset,
                distance_m=int(it.get("distanceMeters", 0)) if ok else None,
                duration_s=_duration_s(it.get("duration")) if ok else None,
            )
        )
    return out


def _waypoint_json(w: Waypoint, *, stopover: bool = False) -> dict[str, Any]:
    if w.place_id:
        d: dict[str, Any] = {"placeId": w.place_id}
    elif w.location is not None:
        d = {"location": {"latLng": {"latitude": w.location.lat, "longitude": w.location.lng}}}
    else:
        raise ValueError("waypoint needs a place_id or a location")
    if stopover:
        d["vehicleStopover"] = True
    return d


# ── client ───────────────────────────────────────────────────────────────────────────────────


class HttpGoogleMapsClient:
    is_fake = False

    def __init__(
        self,
        api_key: str,
        *,
        region: str = "in",
        language: str = "en-IN",
        timeout_seconds: float = 8.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._key = api_key
        self._region = region
        self._language = language
        self._timeout = httpx.Timeout(timeout_seconds)
        self._transport = transport

    async def _send(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        last: MapsUnavailable | None = None
        async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
            for attempt in range(RETRIES + 1):
                if attempt:
                    await asyncio.sleep(RETRY_BACKOFF_SECONDS * attempt)
                try:
                    res = await client.request(method, url, **kwargs)
                except httpx.TimeoutException:
                    log.warning("maps %s timed out", _api(url))
                    last = MapsUnavailable("timeout")
                    continue
                except httpx.HTTPError as exc:
                    log.warning("maps %s transport error: %s", _api(url), type(exc).__name__)
                    last = MapsUnavailable("upstream")
                    continue
                if res.status_code >= 500:
                    log.warning("maps %s upstream %s", _api(url), res.status_code)
                    last = MapsUnavailable("upstream")
                    continue
                return res
        raise last or MapsUnavailable("upstream")

    # Geocoding API ------------------------------------------------------------------------------
    async def _geocode(self, params: dict[str, str], *, place_lookup: bool = False) -> GeocodedPlace:
        res = await self._send(
            "GET", GEOCODE_URL, params={**params, "key": self._key, "language": self._language, "region": self._region}
        )
        if res.status_code == 429:
            raise MapsUnavailable("quota")
        try:
            body = res.json()
        except ValueError:
            raise MapsUnavailable("upstream") from None
        status = str(body.get("status", ""))
        if status == "OK" and body.get("results"):
            return parse_geocode_result(body["results"][0])
        if status in ("ZERO_RESULTS", "NOT_FOUND") or (status == "OK" and not body.get("results")):
            raise AddressNotFound()
        if status == "INVALID_REQUEST" and place_lookup:
            raise AddressNotFound()  # malformed / unknown place id
        reason = "quota" if status in _QUOTA else "denied" if status in _DENIED else "upstream"
        log.error("maps geocode failed: status=%s", status)
        raise MapsUnavailable(reason)  # type: ignore[arg-type]

    async def geocode_address(self, query: str) -> GeocodedPlace:
        return await self._geocode({"address": query, "components": "country:IN"})

    async def geocode_place_id(self, place_id: str) -> GeocodedPlace:
        return await self._geocode({"place_id": place_id}, place_lookup=True)

    async def reverse_geocode(self, location: LatLng) -> GeocodedPlace:
        return await self._geocode(
            {"latlng": f"{location.lat:.6f},{location.lng:.6f}", "result_type": REVERSE_RESULT_TYPES}
        )

    # Routes API ---------------------------------------------------------------------------------
    def _routes_headers(self, mask: str) -> dict[str, str]:
        return {"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": mask, "Content-Type": "application/json"}

    def _raise_routes_error(self, res: httpx.Response) -> None:
        try:
            err = (res.json() or {}).get("error", {})
        except ValueError:
            err = {}
        status = str(err.get("status", ""))
        log.error("maps routes failed: http=%s status=%s", res.status_code, status)
        if res.status_code == 429 or status in _QUOTA:
            raise MapsUnavailable("quota")
        if res.status_code in (401, 403) or status in _DENIED:
            raise MapsUnavailable("denied")
        if res.status_code == 404 or status == "NOT_FOUND":
            raise AddressNotFound()
        raise MapsUnavailable("invalid_request" if res.status_code == 400 else "upstream")

    async def compute_route(self, stops: Sequence[Waypoint]) -> RouteResult:
        if len(stops) < 2:
            raise ValueError("a route needs at least two stops")
        if len(stops) - 2 > MAX_INTERMEDIATES:
            raise ValueError("too many intermediate stops")
        body = {
            "origin": _waypoint_json(stops[0]),
            "destination": _waypoint_json(stops[-1]),
            "intermediates": [_waypoint_json(s, stopover=True) for s in stops[1:-1]],
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_UNAWARE",
            "regionCode": self._region,
            "languageCode": self._language,
            "units": "METRIC",
        }
        res = await self._send("POST", ROUTES_URL, json=body, headers=self._routes_headers(ROUTES_FIELD_MASK))
        if not res.is_success:
            self._raise_routes_error(res)
        return parse_route(res.json() or {}, len(stops))

    async def compute_route_matrix(
        self, origins: Sequence[Waypoint], destinations: Sequence[Waypoint]
    ) -> list[MatrixElement]:
        if not origins or not destinations:
            return []
        out: list[MatrixElement] = []
        # Chunk so each request respects the element and waypoint limits.
        d_chunk = min(len(destinations), MATRIX_MAX_WAYPOINTS - 1, MATRIX_MAX_ELEMENTS)
        o_chunk = max(1, min(MATRIX_MAX_ELEMENTS // d_chunk, MATRIX_MAX_WAYPOINTS - d_chunk))
        for oi in range(0, len(origins), o_chunk):
            for di in range(0, len(destinations), d_chunk):
                body = {
                    "origins": [{"waypoint": _waypoint_json(w)} for w in origins[oi : oi + o_chunk]],
                    "destinations": [{"waypoint": _waypoint_json(w)} for w in destinations[di : di + d_chunk]],
                    "travelMode": "DRIVE",
                    "routingPreference": "TRAFFIC_UNAWARE",
                    "regionCode": self._region,
                    "units": "METRIC",
                }
                res = await self._send("POST", MATRIX_URL, json=body, headers=self._routes_headers(MATRIX_FIELD_MASK))
                if not res.is_success:
                    self._raise_routes_error(res)
                items = res.json() or []
                out.extend(parse_matrix(items if isinstance(items, list) else [], oi, di))
        out.sort(key=lambda e: (e.origin_index, e.destination_index))
        return out


def _api(url: str) -> str:
    return "geocode" if "geocode" in url else "matrix" if "Matrix" in url else "routes"
