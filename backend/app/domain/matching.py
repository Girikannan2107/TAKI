"""Exact trip ↔ shipment matching (P2 §9.3). PURE. Owner: D4.

Used by search (offers, guest search, trip details) and re-run inside ``request_booking`` and
``accept_booking`` so a trip shown as bookable is exactly a trip the server will accept.

Locations are real geocoded coordinates; pincodes are **never** used for matching.

Checks, in order (first failure wins):

1. trip ``published``                                                → ``trip_not_bookable``
2. pickup candidates ``i ∈ [0, n−2]`` with ``haversine(source, cp_i) ≤ cp_i.serviceRadiusKm``;
   drop candidates ``j ∈ [1, n−1]`` with ``haversine(destination, cp_j) ≤ cp_j.serviceRadiusKm``;
   choose ``i < j`` minimising ``d_i + d_j`` (ties: smallest ``i``, then ``j``) → ``not_on_route``
3. date (search only): IST date of ``cp_i.expectedDepartureAt`` equals the searched date → ``wrong_date``
4. not departed: ``cp_i.actualDepartureAt is None`` and ``now < respondBy`` (pickup − 60 min) → ``departed``
5. goods: category accepted, ``temperature_sensitive`` supported, ``maxPackageKg`` → ``goods_not_accepted`` …
6. capacity on the customer's segment (D3 ``domain/capacity``)            → ``insufficient_capacity``
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal

from app.core.time import ist_date_of
from app.domain import capacity
from app.domain.pricing import quote_for_trip, segment_km

RESPOND_LEAD = timedelta(minutes=60)
DEFAULT_RADIUS_KM = 10.0
MAX_RADIUS_KM = 15.0
ROAD_RADIUS_FACTOR = 1.6  # a road distance above radius × 1.6 drops the trip (§9.3 step 8)

OfferProblem = Literal[
    "trip_not_bookable",
    "not_on_route",
    "wrong_date",
    "departed",
    "goods_not_accepted",
    "handling_not_supported",
    "package_too_heavy",
    "insufficient_capacity",
]
HARD_PROBLEMS: frozenset[str] = frozenset({"trip_not_bookable", "not_on_route", "wrong_date", "departed"})
RESTRICTION_PROBLEMS: frozenset[str] = frozenset({"goods_not_accepted", "handling_not_supported", "package_too_heavy"})

OFFER_PROBLEM_MESSAGE: dict[str, str] = {
    "trip_not_bookable": "This trip is no longer accepting bookings.",
    "not_on_route": "This trip doesn't stop near your pickup and drop locations in that order.",
    "wrong_date": "This trip doesn't leave your pickup point on your shipping date.",
    "departed": "This trip has already left (or is about to leave) your pickup point.",
    "goods_not_accepted": "This vehicle doesn't accept your goods category.",
    "handling_not_supported": "This vehicle can't provide the temperature-controlled handling your goods need.",
    "package_too_heavy": "Your package is heavier than this trip allows per package.",
    "insufficient_capacity": "There isn't enough space left on this trip for your shipment.",
    "maps_unavailable": "Road distances are approximate right now.",
}


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def latlng_of(place: Mapping[str, Any] | None) -> tuple[float, float] | None:
    loc = (place or {}).get("location") or {}
    if "lat" not in loc or "lng" not in loc:
        return None
    return float(loc["lat"]), float(loc["lng"])


@dataclass(frozen=True)
class MatchShipment:
    source: tuple[float, float]
    destination: tuple[float, float]
    weight_kg: int
    goods_category: str
    special_handling: tuple[str, ...] = ()


def shipment_for_match(shipment: Mapping[str, Any]) -> MatchShipment:
    src = latlng_of((shipment.get("source") or {}).get("place"))
    dst = latlng_of((shipment.get("destination") or {}).get("place"))
    if src is None or dst is None:
        raise ValueError("shipment without geocoded places")
    pkg = shipment.get("package") or {}
    return MatchShipment(
        source=src,
        destination=dst,
        weight_kg=int(pkg.get("weightKg", 0)),
        goods_category=str(pkg.get("goodsCategory", "general_goods")),
        special_handling=tuple(pkg.get("specialHandling") or ()),
    )


def respond_by(pickup_departure_at: datetime) -> datetime:
    return pickup_departure_at - RESPOND_LEAD


def checkpoint_departure_at(cp: Mapping[str, Any], trip: Mapping[str, Any]) -> datetime:
    return cp.get("expectedDepartureAt") or cp.get("expectedArrivalAt") or trip["departureAt"]


def checkpoint_arrival_at(cp: Mapping[str, Any], trip: Mapping[str, Any]) -> datetime:
    return cp.get("expectedArrivalAt") or cp.get("expectedDepartureAt") or trip["arrivalAt"]


def radius_of(cp: Mapping[str, Any]) -> float:
    r = float(cp.get("serviceRadiusKm") or DEFAULT_RADIUS_KM)
    return min(max(r, 0.0), MAX_RADIUS_KM)


@dataclass(frozen=True)
class Segment:
    pickup_index: int
    drop_index: int
    pickup_distance_km: float
    drop_distance_km: float


def _pick(pickups: list[tuple[int, float]], drops: list[tuple[int, float]]) -> Segment | None:
    best: tuple[float, int, int, float, float] | None = None
    for i, di in pickups:
        for j, dj in drops:
            if i >= j:
                continue
            key = (di + dj, i, j, di, dj)
            if best is None or key[:3] < best[:3]:
                best = key
    if best is None:
        return None
    return Segment(best[1], best[2], round(best[3], 1), round(best[4], 1))


def locate_segment(
    trip: Mapping[str, Any],
    shipment: MatchShipment,
    *,
    date: str | None = None,
    now: datetime | None = None,
) -> Segment | None:
    """Best ``(i, j)`` with ``i < j``. ``date`` restricts pickups to that IST day; ``now`` excludes
    pickups that have departed (or whose respond-by has passed)."""
    cps: Sequence[Mapping[str, Any]] = trip.get("checkpoints") or []
    n = len(cps)
    if n < 2:
        return None
    pickups: list[tuple[int, float]] = []
    for i in range(n - 1):
        loc = latlng_of(cps[i].get("place"))
        if loc is None:
            continue
        d = haversine_km(shipment.source, loc)
        if d > radius_of(cps[i]):
            continue
        dep = checkpoint_departure_at(cps[i], trip)
        if date is not None and ist_date_of(dep).isoformat() != date:
            continue
        if now is not None and (cps[i].get("actualDepartureAt") is not None or now >= respond_by(dep)):
            continue
        pickups.append((i, d))
    drops: list[tuple[int, float]] = []
    for j in range(1, n):
        loc = latlng_of(cps[j].get("place"))
        if loc is None:
            continue
        d = haversine_km(shipment.destination, loc)
        if d <= radius_of(cps[j]):
            drops.append((j, d))
    return _pick(pickups, drops)


def goods_problem(goods: Mapping[str, Any], shipment: MatchShipment) -> str | None:
    if shipment.goods_category not in (goods.get("accepted") or []):
        return "goods_not_accepted"
    if "temperature_sensitive" in shipment.special_handling and "temperature_sensitive" not in (
        goods.get("handlingSupported") or []
    ):
        return "handling_not_supported"
    max_kg = goods.get("maxPackageKg")
    if max_kg is not None and int(max_kg) < shipment.weight_kg:
        return "package_too_heavy"
    return None


@dataclass
class TripMatch:
    pickup_index: int
    drop_index: int
    pickup_distance_km: float
    drop_distance_km: float
    pickup_departure_at: datetime
    drop_arrival_at: datetime
    respond_by: datetime
    segment_km: float
    available_kg: int
    pricing: dict[str, Any]
    match_type: Literal["exact", "intermediate"]
    distance_source: Literal["road", "straight_line"] = "straight_line"
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class MatchResult:
    ok: bool
    problem: str | None
    match: TripMatch | None


def segment_quote(trip: Mapping[str, Any], shipment: MatchShipment, seg: Segment, now: datetime) -> TripMatch:
    cps = trip["checkpoints"]
    i, j = seg.pickup_index, seg.drop_index
    pickup_at = checkpoint_departure_at(cps[i], trip)
    return TripMatch(
        pickup_index=i,
        drop_index=j,
        pickup_distance_km=seg.pickup_distance_km,
        drop_distance_km=seg.drop_distance_km,
        pickup_departure_at=pickup_at,
        drop_arrival_at=checkpoint_arrival_at(cps[j], trip),
        respond_by=respond_by(pickup_at),
        segment_km=segment_km(cps, i, j),
        available_kg=capacity.available_kg(trip, i, j, now),
        pricing=quote_for_trip(trip, i, j, weight_kg=shipment.weight_kg, special_handling=shipment.special_handling),
        match_type="exact" if i == 0 and j == len(cps) - 1 else "intermediate",
    )


def match_trip(
    trip: Mapping[str, Any],
    shipment: MatchShipment,
    now: datetime,
    *,
    date: str | None = None,
    exclude_booking: str | None = None,
) -> MatchResult:
    """Full match. ``date`` (IST, search only) restricts the pickup day."""
    seg_any = locate_segment(trip, shipment)
    match = segment_quote(trip, shipment, seg_any, now) if seg_any else None
    if trip.get("status") != "published":
        return MatchResult(False, "trip_not_bookable", match)
    if seg_any is None:
        return MatchResult(False, "not_on_route", None)
    seg_day = seg_any
    if date is not None:
        dated = locate_segment(trip, shipment, date=date)
        if dated is None:
            return MatchResult(False, "wrong_date", match)
        seg_day = dated
    live = locate_segment(trip, shipment, date=date, now=now)
    if live is None:
        return MatchResult(False, "departed", segment_quote(trip, shipment, seg_day, now))
    m = segment_quote(trip, shipment, live, now)
    if exclude_booking is not None:
        m.available_kg = capacity.available_kg(trip, live.pickup_index, live.drop_index, now, exclude_booking)
    problem = goods_problem(trip.get("goods") or {}, shipment)
    if problem:
        return MatchResult(False, problem, m)
    if m.available_kg < shipment.weight_kg:
        return MatchResult(False, "insufficient_capacity", m)
    return MatchResult(True, None, m)


def match_fixed_segment(
    trip: Mapping[str, Any],
    shipment: MatchShipment,
    i: int,
    j: int,
    now: datetime,
    *,
    exclude_booking: str | None = None,
) -> str | None:
    """Re-check a booking's stored segment at accept time (goods, departure, capacity)."""
    cps = trip.get("checkpoints") or []
    if trip.get("status") != "published":
        return "trip_not_bookable"
    if not (0 <= i < j < len(cps)):
        return "not_on_route"
    dep = checkpoint_departure_at(cps[i], trip)
    if cps[i].get("actualDepartureAt") is not None or now >= respond_by(dep):
        return "departed"
    problem = goods_problem(trip.get("goods") or {}, shipment)
    if problem:
        return problem
    if not capacity.fits(trip, shipment.weight_kg, i, j, now, exclude_booking):
        return "insufficient_capacity"
    return None


# ── sorting and badges (unchanged from src/lib/domain/matching.ts) ─────────────
OfferSort = Literal["price_asc", "price_desc", "departure_asc", "arrival_asc"]


@dataclass(frozen=True)
class SortableOffer:
    trip_id: str
    total_payable: int
    rating_avg: float
    available_kg: int
    pickup_departure_at: datetime
    drop_arrival_at: datetime


def _tie(o: SortableOffer) -> tuple[int, float, str]:
    return (o.total_payable, -o.rating_avg, o.trip_id)


def sort_key(sort: str) -> Any:
    if sort == "price_desc":
        return lambda o: (-o.total_payable, *_tie(o))
    if sort == "departure_asc":
        return lambda o: (o.pickup_departure_at, *_tie(o))
    if sort == "arrival_asc":
        return lambda o: (o.drop_arrival_at, *_tie(o))
    return _tie


def offer_badges(offers: Sequence[SortableOffer]) -> dict[str, str]:
    """Only with ≥ 2 results; one badge per offer; best_price > top_rated > more_capacity."""
    out: dict[str, str] = {}
    if len(offers) < 2:
        return out
    by_price = sorted(offers, key=_tie)

    def pick(score: Any, badge: str) -> None:
        best: SortableOffer | None = None
        for o in by_price:
            if best is None or score(o) > score(best):
                best = o
        if best is not None and best.trip_id not in out:
            out[best.trip_id] = badge

    pick(lambda o: -o.total_payable, "best_price")
    pick(lambda o: o.rating_avg, "top_rated")
    pick(lambda o: o.available_kg, "more_capacity")
    return out


__all__ = [
    "HARD_PROBLEMS",
    "OFFER_PROBLEM_MESSAGE",
    "RESTRICTION_PROBLEMS",
    "ROAD_RADIUS_FACTOR",
    "MatchResult",
    "MatchShipment",
    "Segment",
    "SortableOffer",
    "TripMatch",
    "checkpoint_arrival_at",
    "checkpoint_departure_at",
    "goods_problem",
    "haversine_km",
    "latlng_of",
    "locate_segment",
    "match_fixed_segment",
    "match_trip",
    "offer_badges",
    "radius_of",
    "respond_by",
    "segment_quote",
    "shipment_for_match",
    "sort_key",
]
