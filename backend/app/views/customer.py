"""Customer projections (P2 §12.3, contract §8.2). The ONLY code that turns documents into customer
JSON. Owner: D4.

* Driver name / photo and vehicle registration from ``accepted``; driver phone once paid, until delivered.
* Pickup / delivery OTPs to the customer only, once paid, until each is used.
* Agency and driver ratings at search time; vehicle photos only for signed-in viewers (signed URLs),
  otherwise the illustrative ``imageKey``.
* ``liveLocation`` is always ``null``: no GPS is collected and nothing is interpolated.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from app.core.constants import STATE_NAMES
from app.core.time import iso_z, ist_date_of
from app.domain import booking_machine as bm
from app.domain.matching import OFFER_PROBLEM_MESSAGE, TripMatch, checkpoint_arrival_at, checkpoint_departure_at
from app.schemas.common import district_name_of, place_dto
from app.views.bookings import (
    closure_dto,
    derived,
    event_files,
    payment_summary,
    proof_ids,
    review_dto,
    state_dto,
    visible_events,
)
from app.views.common import file_url, ref_url

Doc = Mapping[str, Any]


# ── shipments ─────────────────────────────────────────────────────────────────
def address_dto(a: Doc) -> dict[str, Any]:
    place = a.get("place") or {}
    p = place_dto(place)
    state = a.get("state") or place.get("state")
    return {
        "line1": a.get("line1", ""),
        "line2": a.get("line2"),
        "landmark": a.get("landmark"),
        "pincode": a.get("pincode", ""),
        "state": state,
        "stateName": STATE_NAMES.get(str(state), place.get("stateName", "")),
        "districtName": district_name_of(place),
        "place": p.model_dump(by_alias=True) if p else None,
        "source": a.get("source", "manual"),
    }


def shipment_dto(s: Doc) -> dict[str, Any]:
    pkg = s.get("package") or {}
    return {
        "id": s["id"],
        "status": s.get("status"),
        "source": address_dto(s.get("source") or {}),
        "destination": address_dto(s.get("destination") or {}),
        "receiver": {
            "name": (s.get("receiver") or {}).get("name", ""),
            "phone": (s.get("receiver") or {}).get("phone", ""),
        },
        "package": {
            "weightKg": int(pkg.get("weightKg", 0)),
            "goodsCategory": pkg.get("goodsCategory"),
            "packageType": pkg.get("packageType"),
            "description": pkg.get("description", ""),
            "pieces": int(pkg.get("pieces", 1)),
            "specialHandling": list(pkg.get("specialHandling") or []),
            "declaredValueRupees": pkg.get("declaredValueRupees"),
        },
        "shippingDate": s.get("shippingDate"),
        "currentBookingId": s.get("currentBookingId"),
        "editable": s.get("status") == "open" and not s.get("currentBookingId"),
        "directDistanceKm": float(s.get("directDistanceKm") or 0.0),
        "createdAt": iso_z(s.get("createdAt")),
        "updatedAt": iso_z(s.get("updatedAt")),
    }


def booking_list_item(b: Doc, trip: Doc | None = None) -> dict[str, Any]:
    d = b.get("display") or {}
    der = derived(b)
    pickup, drop = b.get("pickup") or {}, b.get("drop") or {}
    return {
        "id": b["id"],
        "status": der["status"],
        "tab": der["tab"],
        "state": state_dto(b),
        "matchType": b.get("matchType", "exact"),
        "shipmentId": b.get("shipmentId"),
        "pickup": {
            "placeName": pickup.get("placeName", ""),
            "districtName": pickup.get("district") or pickup.get("placeName", ""),
            "expectedDepartureAt": iso_z(pickup.get("expectedDepartureAt")),
        },
        "drop": {
            "placeName": drop.get("placeName", ""),
            "districtName": drop.get("district") or drop.get("placeName", ""),
            "expectedArrivalAt": iso_z(drop.get("expectedArrivalAt")),
        },
        "weightKg": int(b.get("weightKg", 0)),
        "goodsCategory": b.get("goodsCategory"),
        "totalPayable": int((b.get("pricing") or {}).get("totalPayable", 0)),
        "agencyName": d.get("agencyName", ""),
        "vehicleClass": ((trip or {}).get("vehicle") or {}).get("vehicleClass"),
        "paymentDueAt": iso_z(b.get("paymentDueAt")),
        "reviewed": bool(b.get("reviewed")),
        "createdAt": iso_z(b.get("createdAt")),
        "updatedAt": iso_z(b.get("updatedAt")),
    }


def shipment_list_item(s: Doc, booking: Doc | None, trip: Doc | None = None) -> dict[str, Any]:
    return {**shipment_dto(s), "currentBooking": booking_list_item(booking, trip) if booking else None}


# ── offers / trip details ─────────────────────────────────────────────────────
def _loc(cp: Doc) -> dict[str, Any]:
    return (cp.get("place") or {}).get("location") or {}


def route_stops(trip: Doc, i: int, j: int) -> list[dict[str, Any]]:
    out = []
    for cp in trip.get("checkpoints") or []:
        idx = int(cp.get("index", 0))
        place = cp.get("place") or {}
        loc = _loc(cp)
        out.append(
            {
                "index": idx,
                "placeId": place.get("placeId"),
                "placeName": place.get("name", ""),
                "districtName": district_name_of(place),
                "state": place.get("state"),
                "lat": loc.get("lat"),
                "lng": loc.get("lng"),
                "serviceRadiusKm": float(cp.get("serviceRadiusKm") or 10),
                "kmFromOrigin": float(cp.get("kmFromOrigin") or 0),
                "expectedArrivalAt": iso_z(cp.get("expectedArrivalAt")),
                "expectedDepartureAt": iso_z(cp.get("expectedDepartureAt")),
                "inSegment": i <= idx <= j,
                "role": "pickup" if idx == i else "drop" if idx == j else None,
            }
        )
    return out


def _end(trip: Doc, idx: int, which: str, at: datetime, distance_km: float | None) -> dict[str, Any]:
    cp = (trip.get("checkpoints") or [])[idx]
    place = cp.get("place") or {}
    loc = _loc(cp)
    key = "expectedDepartureAt" if which == "pickup" else "expectedArrivalAt"
    return {
        "checkpointIndex": idx,
        "placeId": place.get("placeId"),
        "placeName": place.get("name", ""),
        "districtName": district_name_of(place),
        "lat": loc.get("lat"),
        "lng": loc.get("lng"),
        key: iso_z(at),
        "distanceKm": distance_km,
    }


def offer_dto(
    trip: Doc,
    *,
    pickup_index: int,
    drop_index: int,
    pickup_at: datetime,
    drop_at: datetime,
    segment_km: float,
    available_kg: int,
    pricing: dict[str, Any],
    match_type: str,
    distance_source: str,
    pickup_km: float | None,
    drop_km: float | None,
    agency: Doc | None,
    driver: Doc | None,
    viewer_uid: str | None,
    badge: str | None = None,
) -> dict[str, Any]:
    vehicle = trip.get("vehicle") or {}
    tdriver = trip.get("driver") or {}
    astats = (agency or {}).get("stats") or {}
    dstats = (driver or {}).get("stats") or {}
    goods = trip.get("goods") or {}
    out: dict[str, Any] = {
        "tripId": trip["id"],
        "matchType": match_type,
        "distanceSource": distance_source,
        "agency": {
            "id": trip.get("agencyId"),
            "name": (agency or {}).get("agencyName") or trip.get("agencyName", ""),
            "ratingAvg": float(astats.get("ratingAvg", 0)),
            "ratingCount": int(astats.get("ratingCount", 0)),
            "verified": ((agency or {}).get("verification") or {}).get("status") == "verified",
        },
        "driver": {
            "ratingAvg": float(dstats.get("ratingAvg", tdriver.get("ratingAvg", 0)) or 0),
            "ratingCount": int(dstats.get("ratingCount", tdriver.get("ratingCount", 0)) or 0),
            "deliveries": int(dstats.get("delivered", 0)),
        },
        "vehicle": {
            "vehicleClass": vehicle.get("vehicleClass"),
            "makeModel": vehicle.get("makeModel", ""),
            "bodyType": vehicle.get("bodyType"),
            "photoUrl": ref_url(vehicle.get("photo"), viewer_uid) if viewer_uid else None,
            "imageKey": vehicle.get("imageKey"),
        },
        "pickup": _end(trip, pickup_index, "pickup", pickup_at, pickup_km),
        "drop": _end(trip, drop_index, "drop", drop_at, drop_km),
        "route": route_stops(trip, pickup_index, drop_index),
        "tripDepartureAt": iso_z(trip.get("departureAt")),
        "tripArrivalAt": iso_z(trip.get("arrivalAt")),
        "segmentKm": segment_km,
        "availableCapacityKg": int(available_kg),
        "offeredCapacityKg": int((trip.get("capacity") or {}).get("offeredKg", 0)),
        "goods": {
            "accepted": list(goods.get("accepted") or []),
            "handlingSupported": list(goods.get("handlingSupported") or []),
            "maxPackageKg": goods.get("maxPackageKg"),
            "notes": goods.get("notes"),
        },
        "rates": {
            "perKmPaise": int((trip.get("rates") or {}).get("perKmPaise", 0)),
            "perKgPaise": int((trip.get("rates") or {}).get("perKgPaise", 0)),
            "additionalCharges": [
                {
                    "label": c.get("label"),
                    "amountRupees": int(c.get("amountRupees", 0)),
                    "basis": c.get("basis", "per_booking"),
                }
                for c in trip.get("additionalCharges") or []
            ],
        },
        "pricing": pricing,
    }
    if badge:
        out["badge"] = badge
    return out


def offer_from_match(
    trip: Doc, m: TripMatch, *, agency: Doc | None, driver: Doc | None, viewer_uid: str | None, badge: str | None = None
) -> dict[str, Any]:
    return offer_dto(
        trip,
        pickup_index=m.pickup_index,
        drop_index=m.drop_index,
        pickup_at=m.pickup_departure_at,
        drop_at=m.drop_arrival_at,
        segment_km=m.segment_km,
        available_kg=m.available_kg,
        pricing=m.pricing,
        match_type=m.match_type,
        distance_source=m.distance_source,
        pickup_km=m.extra.get("pickupRoadKm", m.pickup_distance_km),
        drop_km=m.extra.get("dropRoadKm", m.drop_distance_km),
        agency=agency,
        driver=driver,
        viewer_uid=viewer_uid,
        badge=badge,
    )


def trip_details_dto(
    trip: Doc,
    m: TripMatch,
    *,
    agency: Doc | None,
    driver: Doc | None,
    viewer_uid: str | None,
    reviews: Sequence[Doc],
    problem: str | None,
    existing_booking_id: str | None,
) -> dict[str, Any]:
    a = agency or {}
    created = a.get("createdAt") or trip.get("createdAt")
    return {
        **offer_from_match(trip, m, agency=agency, driver=driver, viewer_uid=viewer_uid),
        "reviews": [review_dto(r) for r in reviews],
        "agencyInfo": {
            "districtName": district_name_of(a.get("base")),
            "statesCovered": list(a.get("statesCovered") or []),
            "memberSince": ist_date_of(created).isoformat() if created else None,
            "delivered": int((a.get("stats") or {}).get("delivered", 0)),
        },
        "problem": problem,
        "problemMessage": OFFER_PROBLEM_MESSAGE.get(problem) if problem else None,
        "existingBookingId": existing_booking_id,
        "routePolyline": (trip.get("route") or {}).get("overviewPolyline", ""),
        "legs": [
            {
                "index": int(leg.get("index", k)),
                "distanceKm": float(leg.get("distanceKm", 0)),
                "durationMin": int(leg.get("durationMin", 0)),
            }
            for k, leg in enumerate(trip.get("legs") or [])
        ],
    }


# ── booking (full) ────────────────────────────────────────────────────────────
def _otps(b: Doc, sec: Doc | None, decrypt: Any) -> dict[str, Any] | None:
    if sec is None or b.get("closure") or b.get("paymentStatus") != "paid":
        return None
    ful = b.get("fulfilmentStatus")
    if ful in ("delivered", "pickup_refused"):
        return None
    pickup_used = sec.get("pickupUsedAt") is not None or ful != "not_started"
    delivery_used = sec.get("deliveryUsedAt") is not None
    return {
        "pickup": None if pickup_used else decrypt(sec.get("pickupOtpEnc")),
        "delivery": None if delivery_used else decrypt(sec.get("deliveryOtpEnc")),
        "pickupUsed": pickup_used,
        "deliveryUsed": delivery_used,
        "pickupLocked": not pickup_used and int(sec.get("pickupAttempts") or 0) >= bm.OTP_ATTEMPTS,
        "deliveryLocked": not delivery_used and int(sec.get("deliveryAttempts") or 0) >= bm.OTP_ATTEMPTS,
    }


def customer_booking_dto(
    b: Doc,
    *,
    shipment: Doc,
    trip: Doc,
    agency: Doc | None,
    driver: Doc | None,
    payment: Any | None,
    secrets: Doc | None,
    review: Doc | None,
    viewer_uid: str,
    now: datetime,
    decrypt: Any,
) -> dict[str, Any]:
    der = derived(b)
    accepted = b.get("approvalStatus") == "accepted"
    paid = b.get("paidAt") is not None
    closed = bool(b.get("closure"))
    ful = b.get("fulfilmentStatus")
    pickup, drop = b.get("pickup") or {}, b.get("drop") or {}
    i, j = int(pickup.get("checkpointIndex", 0)), int(drop.get("checkpointIndex", 1))
    pricing = b.get("pricing") or {}
    trip_view = offer_dto(
        trip,
        pickup_index=i,
        drop_index=j,
        pickup_at=pickup.get("expectedDepartureAt") or checkpoint_departure_at(trip["checkpoints"][i], trip),
        drop_at=drop.get("expectedArrivalAt") or checkpoint_arrival_at(trip["checkpoints"][j], trip),
        segment_km=float(pricing.get("distanceKm", 0)),
        available_kg=0,
        pricing=pricing,
        match_type=b.get("matchType", "exact"),
        distance_source="straight_line",
        pickup_km=pickup.get("distanceKm"),
        drop_km=drop.get("distanceKm"),
        agency=agency,
        driver=driver,
        viewer_uid=viewer_uid,
    )
    tdriver = trip.get("driver") or {}
    vehicle = trip.get("vehicle") or {}
    driver_view = None
    if accepted:
        stats = (driver or {}).get("stats") or {}
        phone_ok = paid and not closed and ful != "delivered"
        driver_view = {
            "name": (driver or {}).get("fullName")
            or (b.get("display") or {}).get("driverName")
            or tdriver.get("fullName", ""),
            "photoUrl": ref_url((driver or {}).get("photo") or tdriver.get("photo"), viewer_uid),
            "phone": (driver or {}).get("phone") if phone_ok else None,
            "ratingAvg": float(stats.get("ratingAvg", tdriver.get("ratingAvg", 0)) or 0),
            "ratingCount": int(stats.get("ratingCount", tdriver.get("ratingCount", 0)) or 0),
        }
    hold = (trip.get("holds") or {}).get(b["id"]) or {}
    due = hold.get("dueAt") or b.get("paymentDueAt")
    window_open = due is None or due > now
    closure = b.get("closure") or {}
    return {
        "id": b["id"],
        "status": der["status"],
        "tab": der["tab"],
        "state": state_dto(b),
        "matchType": b.get("matchType", "exact"),
        "shipment": shipment_dto(shipment),
        "trip": trip_view,
        "pricing": pricing,
        "respondBy": iso_z(b.get("respondBy")),
        "acceptedAt": iso_z(b.get("acceptedAt")),
        "paymentDueAt": iso_z(b.get("paymentDueAt")),
        "paidAt": iso_z(b.get("paidAt")),
        "driverAssignedAt": iso_z(b.get("driverAssignedAt")),
        "payment": payment_summary(payment),
        "driver": driver_view,
        "vehicle": (
            {
                "vehicleClass": vehicle.get("vehicleClass"),
                "makeModel": vehicle.get("makeModel", ""),
                "registrationNumber": (b.get("display") or {}).get("vehicleReg") or vehicle.get("registrationNumber"),
                "bodyType": vehicle.get("bodyType"),
                "imageKey": vehicle.get("imageKey"),
                "photoUrl": ref_url(vehicle.get("photo"), viewer_uid),
            }
            if accepted
            else None
        ),
        "otps": _otps(b, secrets, decrypt),
        "rejection": (
            {"reason": closure.get("reason"), "note": closure.get("note"), "at": iso_z(closure.get("at"))}
            if der["status"] == "rejected"
            else None
        ),
        "cancellation": (
            {
                "reason": closure.get("reason"),
                "note": closure.get("note"),
                "at": iso_z(closure.get("at")),
                "byRole": (closure.get("by") or {}).get("role"),
            }
            if der["status"] == "cancelled"
            else None
        ),
        "statusHistory": [{"status": h.get("status"), "at": iso_z(h.get("at"))} for h in b.get("statusHistory") or []],
        "canCancel": not closed and ful == "not_started" and b.get("approvalStatus") in ("pending", "accepted"),
        "canPay": accepted and not closed and b.get("paymentStatus") in bm.PAYABLE and window_open,
        "canReview": ful == "delivered" and not b.get("reviewed"),
        "review": review_dto(review),
        "createdAt": iso_z(b.get("createdAt")),
        "updatedAt": iso_z(b.get("updatedAt")),
    }


# ── tracking (P2 §13.1) ───────────────────────────────────────────────────────
REJECT_NOTES = {
    "agency_rejected": "Declined by the agency",
    "no_response_before_departure": "The agency didn't respond in time",
    "trip_cancelled": "The trip was cancelled",
}
CANCEL_NOTES = {
    "customer_cancelled": "Cancelled by you",
    "payment_window_expired": "Payment window closed",
    "trip_cancelled": "The trip was cancelled",
    "pickup_refused": "The driver refused pickup",
}


def _row(key: str, label: str, at: datetime | None, **extra: Any) -> dict[str, Any]:
    r = {
        "key": key,
        "label": label,
        "state": "done" if at else "upcoming",
        "at": at,
        "checkpointIndex": None,
        "placeName": None,
        "expectedAt": None,
        "departedAt": None,
        "note": None,
    }
    r.update(extra)
    return r


def tracking_stages(b: Doc, trip: Doc, events: Sequence[Doc]) -> list[dict[str, Any]]:
    def reached(status: str) -> datetime | None:
        return bm.reached_at(b, status)

    def last_of(type_: str) -> Doc | None:
        for e in reversed(events):
            if e.get("type") == type_:
                return e
        return None

    d = b.get("display") or {}
    pickup, drop = b.get("pickup") or {}, b.get("drop") or {}
    accepted_at = b.get("acceptedAt")
    delivered_ev = last_of("delivered")
    stages = [
        _row("booking", "Booking requested", b.get("createdAt"), note=f"Sent to {d.get('agencyName', 'the agency')}"),
        _row(
            "confirmation",
            "Confirmation",
            b.get("paidAt"),
            note=("Accepted and paid" if b.get("paidAt") else "Accepted — awaiting payment")
            if accepted_at
            else "Waiting for the agency",
            expectedAt=None if b.get("paidAt") else (b.get("paymentDueAt") or b.get("respondBy")),
        ),
        _row(
            "pickup",
            "Picked up",
            b.get("pickedUpAt") or reached("picked_up"),
            placeName=pickup.get("placeName"),
            expectedAt=pickup.get("expectedDepartureAt"),
            checkpointIndex=pickup.get("checkpointIndex"),
        ),
        _row("in_transit", "In transit", reached("in_transit")),
    ]
    pi, di = int(pickup.get("checkpointIndex", 0)), int(drop.get("checkpointIndex", 0))
    for cp in trip.get("checkpoints") or []:
        idx = int(cp.get("index", 0))
        if idx <= pi or idx >= di:
            continue
        stages.append(
            _row(
                "checkpoint",
                (cp.get("place") or {}).get("name", ""),
                cp.get("actualArrivalAt"),
                checkpointIndex=idx,
                placeName=(cp.get("place") or {}).get("name"),
                expectedAt=cp.get("expectedArrivalAt"),
                departedAt=cp.get("actualDepartureAt"),
            )
        )
    stages.append(
        _row(
            "out_for_delivery",
            "Out for delivery",
            reached("out_for_delivery"),
            placeName=drop.get("placeName"),
            expectedAt=drop.get("expectedArrivalAt"),
            checkpointIndex=drop.get("checkpointIndex"),
        )
    )
    stages.append(
        _row(
            "delivered",
            "Delivered",
            b.get("deliveredAt") or reached("delivered"),
            placeName=drop.get("placeName"),
            note=(delivered_ev or {}).get("remarks"),
        )
    )
    der = derived(b)
    closed = der["status"] in ("rejected", "cancelled")
    last_done = -1
    for k, s in enumerate(stages):
        if s["state"] == "done":
            last_done = k
    for k, s in enumerate(stages):
        if s["state"] == "done":
            continue
        if closed or k < last_done:
            s["state"] = "skipped"
        elif k == last_done + 1:
            s["state"] = "current"
    closure = b.get("closure") or {}
    if der["status"] == "rejected":
        note = REJECT_NOTES.get(str(closure.get("reason")), "Declined")
        stages.append(
            _row(
                "rejected",
                "Request declined",
                closure.get("at"),
                note=note + (f": {closure['note']}" if closure.get("note") else ""),
            )
        )
    elif der["status"] == "cancelled":
        note = CANCEL_NOTES.get(str(closure.get("reason")), "Cancelled")
        stages.append(
            _row(
                "cancelled",
                "Cancelled",
                closure.get("at"),
                note=note + (f": {closure['note']}" if closure.get("note") else ""),
            )
        )
    for s in stages:
        for k in ("at", "expectedAt", "departedAt"):
            s[k] = iso_z(s[k]) if isinstance(s[k], datetime) else s[k]
    return stages


def tracking_dto(b: Doc, trip: Doc, events: Sequence[Doc], viewer_uid: str) -> dict[str, Any]:
    evs = visible_events(events, "customer")
    pickup, drop = b.get("pickup") or {}, b.get("drop") or {}
    pi, di = int(pickup.get("checkpointIndex", 0)), int(drop.get("checkpointIndex", 0))
    return {
        "bookingId": b["id"],
        "status": derived(b)["status"],
        "state": state_dto(b),
        "stages": tracking_stages(b, trip, evs),
        "events": [
            {
                "id": e["id"],
                "type": e.get("type"),
                "at": iso_z(e.get("at")),
                "clientAt": iso_z(e.get("clientAt")),
                "placeName": e.get("placeName"),
                "remarks": e.get("remarks"),
                "actorRole": (e.get("actor") or {}).get("role", "system"),
                "fileUrls": [file_url(fid, viewer_uid) for fid in event_files(e)],
            }
            for e in evs
        ],
        "proofUrls": [file_url(fid, viewer_uid) for fid in proof_ids(evs)],
        "liveLocation": None,
        "routePolyline": (trip.get("route") or {}).get("overviewPolyline", ""),
        "checkpoints": [
            {
                "index": int(cp.get("index", 0)),
                "placeName": (cp.get("place") or {}).get("name", ""),
                "lat": _loc(cp).get("lat"),
                "lng": _loc(cp).get("lng"),
                "expectedArrivalAt": iso_z(cp.get("expectedArrivalAt")),
                "expectedDepartureAt": iso_z(cp.get("expectedDepartureAt")),
                "actualArrivalAt": iso_z(cp.get("actualArrivalAt")),
                "actualDepartureAt": iso_z(cp.get("actualDepartureAt")),
                "inSegment": pi <= int(cp.get("index", 0)) <= di,
            }
            for cp in trip.get("checkpoints") or []
        ],
    }


__all__ = [
    "address_dto",
    "booking_list_item",
    "closure_dto",
    "customer_booking_dto",
    "offer_dto",
    "offer_from_match",
    "route_stops",
    "shipment_dto",
    "shipment_list_item",
    "tracking_dto",
    "tracking_stages",
    "trip_details_dto",
]
