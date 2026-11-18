"""Customer shipments (E26–E30). Owner: D4.

Addresses are geocoded server-side through D5's Maps integration (P2 §9.1): ``placeId`` →
Geocoding lookup, ``location`` → reverse geocode (browser geolocation granted by the user), manual →
forward geocode of the typed address. The pincode is validated by format only and never used for
matching. Out-of-area / mismatching states are rejected with 422.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.config import get_settings
from app.core.constants import STATE_NAMES
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.core.pagination import decode_cursor, encode_cursor
from app.core.time import ist_today
from app.domain.matching import haversine_km, latlng_of
from app.integrations.maps import LatLng, get_maps
from app.integrations.maps.place_resolver import place_ref
from app.repositories import bookings as bookings_repo
from app.repositories import shipments as shipments_repo
from app.repositories.base import get_doc, run_transaction
from app.views.customer import booking_list_item, shipment_dto, shipment_list_item

BOOKING_WINDOW_DAYS = 60
MIN_DIRECT_KM = 1.0


def check_shipping_date(value: str, now: datetime) -> None:
    today = ist_today(now)
    d = date.fromisoformat(value)
    if d < today:
        raise AppError("past_date", fields={"shippingDate": "Choose today or a later date."})
    if d > today + timedelta(days=BOOKING_WINDOW_DAYS):
        raise AppError("date_too_far", fields={"shippingDate": "Choose a date within the next 60 days."})


async def resolve_address(a: dict[str, Any], field: str, now: datetime) -> dict[str, Any]:
    """``AddressInput`` (camelCase dict) → stored ``Address`` with an authoritative ``PlaceRef``."""
    maps = get_maps()
    try:
        if a["source"] == "autocomplete":
            place = await maps.geocode_place_id(a["placeId"])
        elif a["source"] == "current_location":
            loc = a["location"]
            place = await maps.reverse_geocode(LatLng(float(loc["lat"]), float(loc["lng"])))
        else:
            state_name = STATE_NAMES.get(a["state"], a["state"])
            parts = [a.get("line1"), a.get("line2"), a.get("landmark"), a.get("pincode"), state_name, "India"]
            place = await maps.geocode_address(", ".join(p for p in parts if p))
    except AppError as e:
        if e.code == "address_not_found":
            raise AppError("address_not_found", fields={field: "We couldn't find that address."}) from e
        raise
    service = get_settings().SERVICE_STATES
    if not place.in_service_area(service):
        raise AppError("outside_service_area", fields={field: "This address is outside our service area."})
    if place.state_code != a["state"]:
        raise AppError("address_state_mismatch", fields={f"{field}.state": "The address isn't in the selected state."})
    return {
        "line1": a["line1"],
        "line2": a.get("line2"),
        "landmark": a.get("landmark"),
        "pincode": a["pincode"],
        "state": a["state"],
        "place": place_ref(place, now),
        "source": a["source"],
    }


async def _build_fields(body: dict[str, Any], now: datetime) -> dict[str, Any]:
    check_shipping_date(body["shippingDate"], now)
    source = await resolve_address(body["source"], "source", now)
    destination = await resolve_address(body["destination"], "destination", now)
    a, b = latlng_of(source["place"]), latlng_of(destination["place"])
    assert a is not None and b is not None  # noqa: S101 - place_ref always has a location
    km = haversine_km(a, b)
    if km < MIN_DIRECT_KM:
        raise AppError(
            "invalid_request",
            "Source and destination are the same place.",
            fields={"destination": "Source and destination are the same place"},
        )
    pkg = dict(body["package"])
    pkg.pop("prohibitedItemsDeclaration", None)
    pkg["specialHandling"] = list(dict.fromkeys(pkg.get("specialHandling") or []))
    return {
        "source": source,
        "destination": destination,
        "receiver": {"name": body["receiver"]["name"], "phone": body["receiver"]["phone"]},
        "package": pkg,
        "shippingDate": body["shippingDate"],
        "directDistanceKm": round(km, 1),
    }


def _owned(user: CurrentUser, s: dict[str, Any] | None) -> dict[str, Any]:
    if s is None or user.role != "customer" or s.get("customerId") != user.uid:
        raise AppError("not_found")
    return s


async def create(user: CurrentUser, body: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    fields = await _build_fields(body, now)
    doc = {
        "id": new_id("shp"),
        "customerId": user.uid,
        **fields,
        "status": "open",
        "currentBookingId": None,
        "bookingIds": [],
        "createdAt": now,
        "updatedAt": now,
        "version": 1,
    }
    await shipments_repo.create(doc)
    return shipment_dto(doc)


async def update(user: CurrentUser, shipment_id: str, body: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    _guard_editable(_owned(user, await shipments_repo.get(shipment_id)))
    fields = await _build_fields(body, now)

    async def fn(tx: AsyncTransaction) -> dict[str, Any]:
        s = _guard_editable(_owned(user, await shipments_repo.tx_get_shipment(tx, shipment_id)))
        patch = {**fields, "updatedAt": now, "version": int(s.get("version", 0)) + 1}
        shipments_repo.tx_update(tx, shipment_id, patch)
        return {**s, **patch}

    return shipment_dto(await run_transaction(fn))


def _guard_editable(s: dict[str, Any]) -> dict[str, Any]:
    if s.get("currentBookingId"):
        raise AppError("shipment_has_open_booking", details={"bookingId": s["currentBookingId"]})
    if s.get("status") != "open":
        raise AppError("invalid_transition", "This shipment can no longer be changed.")
    return s


async def withdraw(user: CurrentUser, shipment_id: str, *, now: datetime) -> None:
    async def fn(tx: AsyncTransaction) -> None:
        s = await shipments_repo.tx_get_shipment(tx, shipment_id)
        s = _owned(user, s)
        if s.get("status") == "withdrawn":
            return
        _guard_editable(s)
        shipments_repo.tx_update(
            tx, shipment_id, {"status": "withdrawn", "updatedAt": now, "version": int(s.get("version", 0)) + 1}
        )

    await run_transaction(fn)


async def get_owned(user: CurrentUser, shipment_id: str) -> dict[str, Any]:
    return _owned(user, await shipments_repo.get(shipment_id) if shipment_id.startswith("shp_") else None)


async def detail(user: CurrentUser, shipment_id: str) -> dict[str, Any]:
    s = await get_owned(user, shipment_id)
    rows = await bookings_repo.get_many_ordered(list(reversed(s.get("bookingIds") or [])))
    return {**shipment_dto(s), "bookings": [booking_list_item(b) for b in rows]}


async def list_page(
    user: CurrentUser, *, tab: str | None, limit: int = 20, cursor: str | None = None
) -> dict[str, Any]:
    c = decode_cursor(cursor)
    after = str(c.get("id", "")) if c else None
    if tab is None:
        rows = await shipments_repo.list_for_customer(user.uid, statuses=["open"], limit=limit + 1, after_id=after)
        page = rows[:limit]
        nxt = encode_cursor({"id": page[-1]["id"]}) if len(rows) > limit and page else None
        return {"items": [shipment_list_item(s, None) for s in page], "nextCursor": nxt}
    rows = await bookings_repo.list_for_customer(user.uid, tabs=[tab], limit=limit + 1, after_id=after)
    page = rows[:limit]
    items = []
    for b in page:
        s = await get_doc("shipments", b["shipmentId"])
        if s is not None:
            items.append(shipment_list_item(s, b))
    nxt = encode_cursor({"id": page[-1]["id"]}) if len(rows) > limit and page else None
    return {"items": items, "nextCursor": nxt}


async def open_shipments(user: CurrentUser, limit: int = 5) -> list[dict[str, Any]]:
    rows = await shipments_repo.list_for_customer(user.uid, statuses=["open"], limit=limit)
    return [shipment_list_item(s, None) for s in rows]


__all__ = [
    "check_shipping_date",
    "create",
    "detail",
    "get_owned",
    "list_page",
    "open_shipments",
    "resolve_address",
    "update",
    "withdraw",
]
