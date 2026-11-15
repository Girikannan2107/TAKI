"""FAKE Google Maps for local development and tests (P2 §15.4). Owner: D5.

Used only when ``APP_ENV`` is local/development/test and no server key is configured (or
``MAPS_PROVIDER=fake``). It is deterministic:

- a gazetteer of real towns with their true coordinates, district, state and a main pincode;
  place ids are ``fake_<slug>`` so a fake place can never be mistaken for a Google one;
- forward geocoding matches a town name / alias (longest match wins), then a pincode prefix;
- reverse geocoding returns the nearest gazetteer town within 60 km (it reports *that town's*
  coordinates; it never invents a position);
- routes and matrices use haversine × 1.25 at 55 km/h, with straight-line encoded polylines;
- ``fail_with("quota")`` makes every call raise ``maps_unavailable`` (to test degraded paths).

It is not a tracking source: TAKI never shows a live vehicle position (``liveLocation`` is null).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from . import polyline
from .errors import AddressNotFound, MapsUnavailable, UnavailableReason
from .models import GeocodedPlace, LatLng, MatrixElement, RouteLeg, RouteResult, Waypoint, haversine_km

ROAD_FACTOR = 1.25
SPEED_KMH = 55.0
REVERSE_MAX_KM = 60.0

STATE_NAMES = {
    "TN": "Tamil Nadu",
    "KL": "Kerala",
    "KA": "Karnataka",
    "TG": "Telangana",
    "AP": "Andhra Pradesh",
    "MH": "Maharashtra",
    "GA": "Goa",
}


@dataclass(frozen=True, slots=True)
class _Town:
    name: str
    lat: float
    lng: float
    district: str
    state: str
    pincode: str
    aliases: tuple[str, ...] = ()

    @property
    def slug(self) -> str:
        return re.sub(r"[^a-z0-9]+", "_", self.name.lower()).strip("_")

    @property
    def place_id(self) -> str:
        return f"fake_{self.slug}"

    def to_place(self) -> GeocodedPlace:
        state_name = STATE_NAMES[self.state]
        return GeocodedPlace(
            place_id=self.place_id,
            name=self.name,
            formatted_address=f"{self.name}, {state_name} {self.pincode}, India",
            lat=self.lat,
            lng=self.lng,
            locality=self.name,
            district=self.district,
            state_code=self.state,
            state_name=state_name,
            pincode=self.pincode,
            country_code="IN",
            types=("locality", "political"),
        )


GAZETTEER: tuple[_Town, ...] = (
    # Tamil Nadu
    _Town("Coimbatore", 11.0168, 76.9558, "Coimbatore", "TN", "641001", ("kovai",)),
    _Town("Tiruppur", 11.1085, 77.3411, "Tiruppur", "TN", "641601", ("tirupur",)),
    _Town("Erode", 11.3410, 77.7172, "Erode", "TN", "638001"),
    _Town("Salem", 11.6643, 78.1460, "Salem", "TN", "636001"),
    _Town("Namakkal", 11.2189, 78.1674, "Namakkal", "TN", "637001"),
    _Town("Krishnagiri", 12.5186, 78.2137, "Krishnagiri", "TN", "635001"),
    _Town("Hosur", 12.7409, 77.8253, "Krishnagiri", "TN", "635109"),
    _Town("Vellore", 12.9165, 79.1325, "Vellore", "TN", "632001"),
    _Town("Chennai", 13.0827, 80.2707, "Chennai", "TN", "600001", ("madras",)),
    _Town("Kanchipuram", 12.8342, 79.7036, "Kanchipuram", "TN", "631501", ("kanchi",)),
    _Town("Villupuram", 11.9401, 79.4861, "Viluppuram", "TN", "605602", ("viluppuram",)),
    _Town("Cuddalore", 11.7480, 79.7714, "Cuddalore", "TN", "607001"),
    _Town("Madurai", 9.9252, 78.1198, "Madurai", "TN", "625001"),
    _Town("Tiruchirappalli", 10.7905, 78.7047, "Tiruchirappalli", "TN", "620001", ("trichy", "tiruchi")),
    _Town("Thanjavur", 10.7870, 79.1378, "Thanjavur", "TN", "613001", ("tanjore",)),
    _Town("Dindigul", 10.3624, 77.9695, "Dindigul", "TN", "624001"),
    _Town("Karur", 10.9601, 78.0766, "Karur", "TN", "639001"),
    _Town("Pollachi", 10.6609, 77.0048, "Coimbatore", "TN", "642001"),
    _Town("Ooty", 11.4102, 76.6950, "The Nilgiris", "TN", "643001", ("udhagamandalam",)),
    _Town("Tirunelveli", 8.7139, 77.7567, "Tirunelveli", "TN", "627001"),
    _Town("Thoothukudi", 8.7642, 78.1348, "Thoothukudi", "TN", "628001", ("tuticorin",)),
    _Town("Nagercoil", 8.1833, 77.4119, "Kanniyakumari", "TN", "629001", ("kanyakumari",)),
    # Kerala
    _Town("Kochi", 9.9312, 76.2673, "Ernakulam", "KL", "682001", ("cochin", "ernakulam")),
    _Town("Thrissur", 10.5276, 76.2144, "Thrissur", "KL", "680001", ("trichur",)),
    _Town("Palakkad", 10.7867, 76.6548, "Palakkad", "KL", "678001", ("palghat",)),
    _Town("Kozhikode", 11.2588, 75.7804, "Kozhikode", "KL", "673001", ("calicut",)),
    _Town("Thiruvananthapuram", 8.5241, 76.9366, "Thiruvananthapuram", "KL", "695001", ("trivandrum",)),
    _Town("Kollam", 8.8932, 76.6141, "Kollam", "KL", "691001", ("quilon",)),
    _Town("Kottayam", 9.5916, 76.5222, "Kottayam", "KL", "686001"),
    # Karnataka
    _Town("Bengaluru", 12.9716, 77.5946, "Bengaluru Urban", "KA", "560001", ("bangalore",)),
    _Town("Mysuru", 12.2958, 76.6394, "Mysuru", "KA", "570001", ("mysore",)),
    _Town("Mangaluru", 12.9141, 74.8560, "Dakshina Kannada", "KA", "575001", ("mangalore",)),
    _Town("Hubballi", 15.3647, 75.1240, "Dharwad", "KA", "580020", ("hubli",)),
    _Town("Belagavi", 15.8497, 74.4977, "Belagavi", "KA", "590001", ("belgaum",)),
    _Town("Tumakuru", 13.3379, 77.1173, "Tumakuru", "KA", "572101", ("tumkur",)),
    # Telangana
    _Town("Hyderabad", 17.3850, 78.4867, "Hyderabad", "TG", "500001", ("secunderabad",)),
    _Town("Warangal", 17.9689, 79.5941, "Warangal", "TG", "506002"),
    # Andhra Pradesh
    _Town("Vijayawada", 16.5062, 80.6480, "NTR", "AP", "520001", ("bezawada",)),
    _Town("Visakhapatnam", 17.6868, 83.2185, "Visakhapatnam", "AP", "530001", ("vizag",)),
    _Town("Tirupati", 13.6288, 79.4192, "Tirupati", "AP", "517501"),
    _Town("Nellore", 14.4426, 79.9865, "Nellore", "AP", "524001"),
    _Town("Guntur", 16.3067, 80.4365, "Guntur", "AP", "522001"),
    _Town("Kurnool", 15.8281, 78.0373, "Kurnool", "AP", "518001"),
    # Outside the service area (for outside_service_area tests)
    _Town("Mumbai", 19.0760, 72.8777, "Mumbai City", "MH", "400001", ("bombay",)),
    _Town("Pune", 18.5204, 73.8567, "Pune", "MH", "411001"),
    _Town("Panaji", 15.4909, 73.8278, "North Goa", "GA", "403001", ("panjim",)),
)

_BY_PLACE_ID = {t.place_id: t for t in GAZETTEER}
_PIN_RE = re.compile(r"\b([1-9]\d{5})\b")


def _road_km(a: LatLng, b: LatLng) -> float:
    return haversine_km(a, b) * ROAD_FACTOR


def _seconds(km: float) -> int:
    return round(km / SPEED_KMH * 3600)


class FakeMapsClient:
    """Deterministic stand-in for :class:`HttpGoogleMapsClient` (development/test only)."""

    is_fake = True

    def __init__(self) -> None:
        self.unavailable: UnavailableReason | None = None
        self.calls: list[str] = []

    def fail_with(self, reason: UnavailableReason | None) -> None:
        self.unavailable = reason

    def _check(self, op: str) -> None:
        self.calls.append(op)
        if self.unavailable:
            raise MapsUnavailable(self.unavailable)

    @staticmethod
    def towns() -> tuple[GeocodedPlace, ...]:
        return tuple(t.to_place() for t in GAZETTEER)

    async def geocode_address(self, query: str) -> GeocodedPlace:
        self._check("geocode")
        q = f" {re.sub(r'[^a-z0-9]+', ' ', query.lower())} "
        best: tuple[int, _Town] | None = None
        for t in GAZETTEER:
            for name in (t.name.lower(), *t.aliases):
                if f" {name} " in q and (best is None or len(name) > best[0]):
                    best = (len(name), t)
        if best is not None:
            return best[1].to_place()
        pin = _PIN_RE.search(query)
        if pin:
            exact = next((t for t in GAZETTEER if t.pincode == pin.group(1)), None)
            prefix = next((t for t in GAZETTEER if t.pincode[:3] == pin.group(1)[:3]), None)
            if exact or prefix:
                return (exact or prefix).to_place()  # type: ignore[union-attr]
        raise AddressNotFound()

    async def geocode_place_id(self, place_id: str) -> GeocodedPlace:
        self._check("geocode_place")
        town = _BY_PLACE_ID.get(place_id)
        if town is None:
            raise AddressNotFound()
        return town.to_place()

    async def reverse_geocode(self, location: LatLng) -> GeocodedPlace:
        self._check("reverse_geocode")
        town = min(GAZETTEER, key=lambda t: haversine_km(location, LatLng(t.lat, t.lng)))
        if haversine_km(location, LatLng(town.lat, town.lng)) > REVERSE_MAX_KM:
            raise AddressNotFound()
        return town.to_place()

    async def _resolve(self, w: Waypoint) -> LatLng:
        if w.location is not None:
            return w.location
        town = _BY_PLACE_ID.get(w.place_id or "")
        if town is None:
            raise AddressNotFound()
        return LatLng(town.lat, town.lng)

    async def compute_route(self, stops: Sequence[Waypoint]) -> RouteResult:
        self._check("route")
        if len(stops) < 2:
            raise ValueError("a route needs at least two stops")
        points = [await self._resolve(s) for s in stops]
        legs = []
        for i in range(len(points) - 1):
            km = _road_km(points[i], points[i + 1])
            legs.append(
                RouteLeg(
                    index=i,
                    distance_m=round(km * 1000),
                    duration_s=_seconds(km),
                    polyline=polyline.encode([(points[i].lat, points[i].lng), (points[i + 1].lat, points[i + 1].lng)]),
                )
            )
        return RouteResult(
            distance_m=sum(leg.distance_m for leg in legs),
            duration_s=sum(leg.duration_s for leg in legs),
            polyline=polyline.encode([(p.lat, p.lng) for p in points]),
            legs=tuple(legs),
        )

    async def compute_route_matrix(
        self, origins: Sequence[Waypoint], destinations: Sequence[Waypoint]
    ) -> list[MatrixElement]:
        self._check("matrix")
        o_pts = [await self._resolve(o) for o in origins]
        d_pts = [await self._resolve(d) for d in destinations]
        out = []
        for oi, o in enumerate(o_pts):
            for di, d in enumerate(d_pts):
                km = _road_km(o, d)
                out.append(MatrixElement(oi, di, round(km * 1000), _seconds(km)))
        return out


def fake_place(name: str) -> GeocodedPlace:
    """Test helper: the gazetteer place for a town name (``KeyError`` if unknown)."""
    for t in GAZETTEER:
        if t.name.lower() == name.lower():
            return t.to_place()
    raise KeyError(name)


__all__ = ["GAZETTEER", "FakeMapsClient", "fake_place"]
