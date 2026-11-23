"""Maps value objects (P2 §9.1). Owner: D5. Provider-neutral; shared by the Google client and the fake."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

# Google's administrative_area_level_1 long names → TAKI state codes (ISO 3166-2:IN suffixes; Telangana = TG).
STATE_CODES: dict[str, str] = {
    "andaman and nicobar islands": "AN",
    "andhra pradesh": "AP",
    "arunachal pradesh": "AR",
    "assam": "AS",
    "bihar": "BR",
    "chandigarh": "CH",
    "chhattisgarh": "CT",
    "dadra and nagar haveli and daman and diu": "DH",
    "delhi": "DL",
    "goa": "GA",
    "gujarat": "GJ",
    "haryana": "HR",
    "himachal pradesh": "HP",
    "jammu and kashmir": "JK",
    "jharkhand": "JH",
    "karnataka": "KA",
    "kerala": "KL",
    "ladakh": "LA",
    "lakshadweep": "LD",
    "madhya pradesh": "MP",
    "maharashtra": "MH",
    "manipur": "MN",
    "meghalaya": "ML",
    "mizoram": "MZ",
    "nagaland": "NL",
    "odisha": "OR",
    "puducherry": "PY",
    "punjab": "PB",
    "rajasthan": "RJ",
    "sikkim": "SK",
    "tamil nadu": "TN",
    "telangana": "TG",
    "tripura": "TR",
    "uttar pradesh": "UP",
    "uttarakhand": "UK",
    "west bengal": "WB",
}
# Google sometimes returns short names (e.g. "TN", "KA"); map the ones that differ from TAKI codes.
_SHORT_NAME_ALIASES: dict[str, str] = {"TS": "TG", "OD": "OR", "UT": "UK", "CG": "CT"}


def state_code_for(long_name: str | None, short_name: str | None = None) -> str | None:
    if long_name:
        code = STATE_CODES.get(long_name.strip().lower())
        if code:
            return code
    if short_name:
        s = short_name.strip().upper()
        s = _SHORT_NAME_ALIASES.get(s, s)
        if s in STATE_CODES.values():
            return s
    return None


@dataclass(frozen=True, slots=True)
class LatLng:
    lat: float
    lng: float

    def rounded(self, places: int = 5) -> LatLng:
        return LatLng(round(self.lat, places), round(self.lng, places))


@dataclass(frozen=True, slots=True)
class Waypoint:
    """A route stop: a Google place id or a coordinate (at least one)."""

    place_id: str | None = None
    location: LatLng | None = None

    def key(self) -> str:
        if self.location is not None:
            loc = self.location.rounded(5)
            return f"{loc.lat:.5f},{loc.lng:.5f}"
        return f"place:{self.place_id}"


@dataclass(frozen=True, slots=True)
class GeocodedPlace:
    """Authoritative place (maps to the API's ``PlaceDTO``)."""

    place_id: str
    name: str
    formatted_address: str
    lat: float
    lng: float
    locality: str | None
    district: str | None
    state_code: str | None
    state_name: str | None
    pincode: str | None
    country_code: str | None
    types: tuple[str, ...] = field(default_factory=tuple)

    @property
    def location(self) -> LatLng:
        return LatLng(self.lat, self.lng)

    def in_service_area(self, service_states: list[str] | tuple[str, ...]) -> bool:
        return self.country_code == "IN" and self.state_code is not None and self.state_code in service_states

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["types"] = list(self.types)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> GeocodedPlace:
        return cls(**{**d, "types": tuple(d.get("types") or ())})


@dataclass(frozen=True, slots=True)
class RouteLeg:
    index: int
    distance_m: int
    duration_s: int
    polyline: str

    @property
    def distance_km(self) -> float:
        return round(self.distance_m / 1000, 1)

    @property
    def duration_min(self) -> int:
        return math.ceil(self.duration_s / 60)


@dataclass(frozen=True, slots=True)
class RouteResult:
    distance_m: int
    duration_s: int
    polyline: str  # overview encoded polyline
    legs: tuple[RouteLeg, ...]

    @property
    def distance_km(self) -> float:
        return round(self.distance_m / 1000, 1)

    @property
    def duration_min(self) -> int:
        return math.ceil(self.duration_s / 60)

    def km_from_origin(self) -> list[float]:
        """Cumulative km at each stop (index 0 = 0.0), 1 decimal."""
        out, acc = [0.0], 0
        for leg in self.legs:
            acc += leg.distance_m
            out.append(round(acc / 1000, 1))
        return out

    def to_dict(self) -> dict[str, Any]:
        return {
            "distance_m": self.distance_m,
            "duration_s": self.duration_s,
            "polyline": self.polyline,
            "legs": [asdict(leg) for leg in self.legs],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RouteResult:
        return cls(
            distance_m=int(d["distance_m"]),
            duration_s=int(d["duration_s"]),
            polyline=str(d["polyline"]),
            legs=tuple(RouteLeg(**leg) for leg in d.get("legs", [])),
        )


@dataclass(frozen=True, slots=True)
class MatrixElement:
    origin_index: int
    destination_index: int
    distance_m: int | None  # None when no route exists
    duration_s: int | None

    @property
    def route_exists(self) -> bool:
        return self.distance_m is not None

    @property
    def distance_km(self) -> float | None:
        return None if self.distance_m is None else round(self.distance_m / 1000, 1)


def haversine_km(a: LatLng, b: LatLng) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lng - a.lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))
