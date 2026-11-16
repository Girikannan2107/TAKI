"""Route matching for customers (E31–E33, P2 §9.2–§9.3). Owner: D4.

One indexed Firestore query per search: published trips whose ``searchKeys`` contain
``"{geohash4(source)}|{IST date}"``, ordered by departure. Everything else (radius, stop order,
departure, goods, segment capacity, user filters, sort, badges) runs in memory through the same pure
``domain.matching.match_trip`` that ``request_booking`` re-runs. Road distances from Google Routes
``computeRouteMatrix`` (cached by D5's client) are added for the best ≤ 25 offers; if Maps fails the
offers are still returned with ``distanceSource = "straight_line"``. Never pincodes.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.config import get_settings
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.time import ist_today
from app.domain.geo import search_key_for
from app.domain.matching import (
    HARD_PROBLEMS,
    RESTRICTION_PROBLEMS,
    ROAD_RADIUS_FACTOR,
    MatchShipment,
    SortableOffer,
    TripMatch,
    locate_segment,
    match_trip,
    offer_badges,
    radius_of,
    segment_quote,
    shipment_for_match,
    sort_key,
)
from app.integrations.maps import LatLng, Waypoint, get_maps
from app.repositories import reviews as reviews_repo
from app.repositories.base import C, get_db, get_doc, query_docs
from app.services.shipment_service import get_owned
from app.views.customer import offer_from_match, trip_details_dto

log = logging.getLogger("taki.search")

SCAN_LIMIT = 200
RESULT_LIMIT = 100
ROAD_LIMIT = 25
DETAIL_REVIEWS = 5
WINDOW_DAYS = 60


async def _docs(collection: str, ids: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for i in dict.fromkeys(x for x in ids if x):
        d = await get_doc(collection, i)
        if d is not None:
            out[i] = d
    return out


async def _road_distances(
    ms: MatchShipment, rows: list[tuple[dict[str, Any], TripMatch]]
) -> list[tuple[dict[str, Any], TripMatch]]:
    """Adds road km to the first ``ROAD_LIMIT`` rows; drops trips whose road distance exceeds radius × 1.6."""
    head, tail = rows[:ROAD_LIMIT], rows[ROAD_LIMIT:]
    if not head:
        return rows
    try:
        maps = get_maps()
        pick_wps: list[Waypoint] = []
        drop_wps: list[Waypoint] = []
        for trip, m in head:
            for idx, bucket in ((m.pickup_index, pick_wps), (m.drop_index, drop_wps)):
                loc = (trip["checkpoints"][idx].get("place") or {}).get("location") or {}
                bucket.append(Waypoint(location=LatLng(float(loc["lat"]), float(loc["lng"]))))
        src = Waypoint(location=LatLng(*ms.source))
        dst = Waypoint(location=LatLng(*ms.destination))
        to_pick = await maps.compute_route_matrix([src], pick_wps)
        from_drop = await maps.compute_route_matrix(drop_wps, [dst])
    except AppError as e:
        log.info("route matrix unavailable (%s); straight-line distances", e.code)
        return rows
    pick_km = {el.destination_index: el.distance_km for el in to_pick}
    drop_km = {el.origin_index: el.distance_km for el in from_drop}
    kept: list[tuple[dict[str, Any], TripMatch]] = []
    for k, (trip, m) in enumerate(head):
        pk, dk = pick_km.get(k), drop_km.get(k)
        if pk is None or dk is None:
            kept.append((trip, m))
            continue
        cps = trip["checkpoints"]
        if (
            pk > radius_of(cps[m.pickup_index]) * ROAD_RADIUS_FACTOR
            or dk > radius_of(cps[m.drop_index]) * ROAD_RADIUS_FACTOR
        ):
            continue
        m.distance_source = "road"
        m.extra["pickupRoadKm"] = pk
        m.extra["dropRoadKm"] = dk
        kept.append((trip, m))
    return kept + tail


async def find_offers(
    ms: MatchShipment, day: str, filters: dict[str, Any], now: datetime, viewer: CurrentUser | None
) -> dict[str, Any]:
    key = search_key_for({"lat": ms.source[0], "lng": ms.source[1]}, day)
    q = (
        get_db()
        .collection(C.trips)
        .where(filter=FieldFilter("searchKeys", "array_contains", key))
        .where(filter=FieldFilter("status", "==", "published"))
        .order_by("departureAt")
        .limit(SCAN_LIMIT)
    )
    trips = await query_docs(q)
    excluded_capacity = excluded_restrictions = 0
    matched: list[tuple[dict[str, Any], TripMatch]] = []
    for trip in trips:
        r = match_trip(trip, ms, now, date=day)
        if r.ok and r.match is not None:
            matched.append((trip, r.match))
        elif r.problem in HARD_PROBLEMS:
            continue
        elif r.problem == "insufficient_capacity":
            excluded_capacity += 1
        elif r.problem in RESTRICTION_PROBLEMS:
            excluded_restrictions += 1
    agencies = await _docs(C.agencies, [t["agencyId"] for t, _ in matched])
    matched = [
        (t, m)
        for t, m in matched
        if ((agencies.get(t["agencyId"]) or {}).get("verification") or {}).get("status") == "verified"
    ]
    vclasses = filters.get("vehicleClass") or []
    min_price, max_price, min_cap = filters.get("minPrice"), filters.get("maxPrice"), filters.get("minCapacityKg")

    def keep(t: dict[str, Any], m: TripMatch) -> bool:
        total = int(m.pricing["totalPayable"])
        if vclasses and (t.get("vehicle") or {}).get("vehicleClass") not in vclasses:
            return False
        if min_price is not None and total < min_price:
            return False
        if max_price is not None and total > max_price:
            return False
        return not (min_cap is not None and m.available_kg < min_cap)

    rows = [(t, m) for t, m in matched if keep(t, m)]

    def sortable(t: dict[str, Any], m: TripMatch) -> SortableOffer:
        return SortableOffer(
            trip_id=t["id"],
            total_payable=int(m.pricing["totalPayable"]),
            rating_avg=float(((agencies.get(t["agencyId"]) or {}).get("stats") or {}).get("ratingAvg", 0)),
            available_kg=m.available_kg,
            pickup_departure_at=m.pickup_departure_at,
            drop_arrival_at=m.drop_arrival_at,
        )

    keyf = sort_key(filters.get("sort") or "price_asc")
    rows.sort(key=lambda r: keyf(sortable(*r)))
    rows = await _road_distances(ms, rows)
    rows = rows[:RESULT_LIMIT]
    badges = offer_badges([sortable(t, m) for t, m in rows])
    drivers = await _docs(C.drivers, [t.get("driverId") or "" for t, _ in rows])
    uid = viewer.uid if viewer else None
    items = [
        offer_from_match(
            t,
            m,
            agency=agencies.get(t["agencyId"]),
            driver=drivers.get(t.get("driverId") or ""),
            viewer_uid=uid,
            badge=badges.get(t["id"]),
        )
        for t, m in rows
    ]
    return {
        "items": items,
        "excludedForCapacity": excluded_capacity,
        "excludedForRestrictions": excluded_restrictions,
        "date": day,
    }


def _clamp(day: str, now: datetime) -> str:
    today = ist_today(now)
    return max(day, today.isoformat())


async def offers_for_shipment(
    user: CurrentUser, shipment_id: str, filters: dict[str, Any], *, now: datetime
) -> dict[str, Any]:
    s = await get_owned(user, shipment_id)
    if s.get("status") != "open" or s.get("currentBookingId"):
        raise AppError("invalid_transition", "This shipment already has a booking.")
    day = _clamp(filters.get("date") or s["shippingDate"], now)
    return await find_offers(shipment_for_match(s), day, filters, now, user)


async def _guest_place(place_id: str, field: str) -> tuple[float, float]:
    try:
        place = await get_maps().geocode_place_id(place_id)
    except AppError as e:
        if e.code == "address_not_found":
            raise AppError("address_not_found", fields={field: "We couldn't find that place."}) from e
        raise
    if not place.in_service_area(get_settings().SERVICE_STATES):
        raise AppError("outside_service_area", fields={field: "This place is outside our service area."})
    return place.lat, place.lng


def _check_day(day: str, now: datetime) -> None:
    today = ist_today(now)
    d = date.fromisoformat(day)
    if d < today:
        raise AppError("past_date", fields={"date": "Choose today or a later date."})
    if d > today + timedelta(days=WINDOW_DAYS):
        raise AppError("date_too_far", fields={"date": "Choose a date within the next 60 days."})


async def guest_search(q: dict[str, Any], *, now: datetime, viewer: CurrentUser | None) -> dict[str, Any]:
    _check_day(q["date"], now)
    src = await _guest_place(q["fromPlaceId"], "fromPlaceId")
    dst = await _guest_place(q["toPlaceId"], "toPlaceId")
    ms = MatchShipment(
        source=src,
        destination=dst,
        weight_kg=int(q["weightKg"]),
        goods_category=q.get("goods") or "general_goods",
        special_handling=tuple(q.get("handling") or ()),
    )
    return await find_offers(ms, q["date"], q, now, viewer)


async def trip_details(trip_id: str, q: dict[str, Any], *, now: datetime, viewer: CurrentUser | None) -> dict[str, Any]:
    existing: str | None = None
    if q.get("shipmentId"):
        if viewer is None:
            raise AppError("unauthenticated")
        s = await get_owned(viewer, q["shipmentId"])
        ms = shipment_for_match(s)
        existing = s.get("currentBookingId")
    elif q.get("fromPlaceId") and q.get("toPlaceId") and q.get("weightKg"):
        ms = MatchShipment(
            source=await _guest_place(q["fromPlaceId"], "fromPlaceId"),
            destination=await _guest_place(q["toPlaceId"], "toPlaceId"),
            weight_kg=int(q["weightKg"]),
            goods_category=q.get("goods") or "general_goods",
            special_handling=tuple(q.get("handling") or ()),
        )
    else:
        raise AppError(
            "invalid_request",
            "Add your shipment details to see this vehicle's price.",
            fields={"shipmentId": "Required"},
        )
    trip = await get_doc(C.trips, trip_id) if trip_id.startswith("trp_") else None
    if trip is None or trip.get("status") == "draft":
        raise AppError("not_found")
    agency = await get_doc(C.agencies, trip.get("agencyId", ""))
    if agency is None or (agency.get("verification") or {}).get("status") != "verified":
        raise AppError("not_found")
    seg = locate_segment(trip, ms)
    if seg is None:
        raise AppError("not_on_route")
    result = match_trip(trip, ms, now)
    m = result.match if result.match is not None else segment_quote(trip, ms, seg, now)
    driver = await get_doc(C.drivers, trip.get("driverId") or "") if trip.get("driverId") else None
    reviews = (
        await reviews_repo.list_for("driverId", trip["driverId"], limit=DETAIL_REVIEWS) if trip.get("driverId") else []
    )
    dto = trip_details_dto(
        trip,
        m,
        agency=agency,
        driver=driver,
        viewer_uid=viewer.uid if viewer else None,
        reviews=reviews,
        problem=None if result.ok else result.problem,
        existing_booking_id=existing,
    )
    return dto


__all__ = ["find_offers", "guest_search", "offers_for_shipment", "trip_details"]
