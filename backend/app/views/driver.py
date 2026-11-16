"""Driver projections (P2 §12.3, contract §11.2). The ONLY code that turns booking / shipment / trip
documents into driver JSON. Owner: D4.

* A driver sees a booking only when it is assigned to them and was paid (``paidAt`` set).
* Customer and receiver phones and full addresses only while the booking is paid and the goods are
  not yet delivered / refused / closed; afterwards ``null``.
* Pricing and OTPs are never included (the driver *enters* the codes).
* No location is ever collected from the driver; ``lat``/``lng`` are the geocoded addresses.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from app.core.time import iso_z
from app.domain import booking_machine as bm
from app.domain import capacity
from app.schemas.common import district_name_of
from app.views.bookings import contacts_live, derived, event_files, proof_ids, state_dto, visible_events
from app.views.common import file_url, ref_url

Doc = Mapping[str, Any]


def maps_url(lat: float | None, lng: float | None) -> str | None:
    if lat is None or lng is None:
        return None
    return f"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"


def _short(a: Doc | None) -> str:
    if not a:
        return ""
    line = str(a.get("line1", ""))
    if len(line) > 48:
        line = line[:47] + "…"
    return f"{line}, {district_name_of(a.get('place'))}"


def address_dto(a: Doc) -> dict[str, Any]:
    place = a.get("place") or {}
    loc = place.get("location") or {}
    return {
        "line1": a.get("line1", ""),
        "line2": a.get("line2"),
        "landmark": a.get("landmark"),
        "districtName": district_name_of(place),
        "state": a.get("state") or place.get("state"),
        "pincode": a.get("pincode", ""),
        "lat": loc.get("lat"),
        "lng": loc.get("lng"),
        "mapsUrl": maps_url(loc.get("lat"), loc.get("lng")),
    }


def shipment_list_item(b: Doc, s: Doc | None) -> dict[str, Any]:
    live = contacts_live(b)
    d = b.get("display") or {}
    pickup, drop = b.get("pickup") or {}, b.get("drop") or {}
    pkg = (s or {}).get("package") or {}
    der = derived(b)
    return {
        "bookingId": b["id"],
        "tripId": b.get("tripId"),
        "status": der["status"],
        "state": state_dto(b),
        "matchType": b.get("matchType", "exact"),
        "customerName": d.get("customerName", ""),
        "receiverName": ((s or {}).get("receiver") or {}).get("name") or d.get("receiverName") or "Receiver",
        "pickup": {
            "checkpointIndex": pickup.get("checkpointIndex"),
            "placeName": pickup.get("placeName", ""),
            "districtName": pickup.get("district") or pickup.get("placeName", ""),
            "district": pickup.get("district") or pickup.get("placeName", ""),
            "expectedAt": iso_z(pickup.get("expectedDepartureAt")),
            "shortAddress": _short((s or {}).get("source")) if live else (pickup.get("district") or ""),
        },
        "drop": {
            "checkpointIndex": drop.get("checkpointIndex"),
            "placeName": drop.get("placeName", ""),
            "districtName": drop.get("district") or drop.get("placeName", ""),
            "district": drop.get("district") or drop.get("placeName", ""),
            "expectedAt": iso_z(drop.get("expectedArrivalAt")),
            "shortAddress": _short((s or {}).get("destination")) if live else (drop.get("district") or ""),
        },
        "package": {
            "weightKg": int(b.get("weightKg", 0)),
            "pieces": int(pkg.get("pieces", 1)),
            "packageType": pkg.get("packageType", "other"),
            "goodsCategory": b.get("goodsCategory"),
            "specialHandling": list(b.get("specialHandling") or []),
        },
        "trip": {
            "id": b.get("tripId"),
            "routeLabel": d.get("routeLabel", ""),
            "departureAt": iso_z(d.get("tripDepartureAt")),
            "vehicleReg": d.get("vehicleReg") or "",
        },
        "updatedAt": iso_z(b.get("updatedAt")),
        "deliveredAt": iso_z(b.get("deliveredAt")),
    }


def allowed_actions(b: Doc, trip: Doc | None) -> list[str]:
    if b.get("closure"):
        return []
    running = trip is None or trip.get("status") in ("published", "in_progress")
    ful = b.get("fulfilmentStatus")
    if b.get("paymentStatus") == "paid" and ful == "not_started":
        return ["pickup", "refuse_pickup", "remark"] if running else ["remark"]
    return {
        "picked_up": ["start_transit", "remark"],
        "in_transit": ["out_for_delivery", "remark"],
        "out_for_delivery": ["deliver", "remark"],
    }.get(str(ful), [])


def event_dto(e: Doc, viewer_uid: str) -> dict[str, Any]:
    return {
        "id": e["id"],
        "type": e.get("type"),
        "at": iso_z(e.get("at")),
        "clientAt": iso_z(e.get("clientAt")),
        "placeName": e.get("placeName"),
        "remarks": e.get("remarks"),
        "fileUrls": [file_url(fid, viewer_uid) for fid in event_files(e)],
        "byRole": (e.get("actor") or {}).get("role", "system"),
    }


def _brief(b: Doc, trip: Doc | None) -> list[dict[str, Any]]:
    if not trip:
        return []
    pi = int((b.get("pickup") or {}).get("checkpointIndex", 0))
    di = int((b.get("drop") or {}).get("checkpointIndex", 0))
    out = []
    for c in trip.get("checkpoints") or []:
        idx = int(c.get("index", 0))
        if not pi <= idx <= di:
            continue
        place = c.get("place") or {}
        loc = place.get("location") or {}
        out.append(
            {
                "index": idx,
                "placeId": place.get("placeId"),
                "placeName": place.get("name", ""),
                "districtName": district_name_of(place),
                "lat": loc.get("lat"),
                "lng": loc.get("lng"),
                "expectedArrivalAt": iso_z(c.get("expectedArrivalAt")),
                "expectedDepartureAt": iso_z(c.get("expectedDepartureAt")),
                "actualArrivalAt": iso_z(c.get("actualArrivalAt")),
                "actualDepartureAt": iso_z(c.get("actualDepartureAt")),
                "isPickup": idx == pi,
                "isDrop": idx == di,
            }
        )
    return out


def shipment_dto(
    b: Doc,
    s: Doc | None,
    trip: Doc | None,
    events: Sequence[Doc],
    *,
    customer_phone: str | None,
    viewer_uid: str,
) -> dict[str, Any]:
    live = contacts_live(b)
    evs = visible_events(events, "driver")
    delivered = next((e for e in reversed(evs) if e.get("type") == "delivered"), None)
    receiver = (s or {}).get("receiver") or {}
    closure = b.get("closure") or {}
    vehicle = (trip or {}).get("vehicle") or {}
    return {
        **shipment_list_item(b, s),
        "customer": {
            "name": (b.get("display") or {}).get("customerName", ""),
            "phone": customer_phone if live else None,
        },
        "receiver": {"name": receiver.get("name", "Receiver"), "phone": receiver.get("phone") if live else None},
        "pickupAddress": address_dto((s or {}).get("source") or {}) if live and s else None,
        "dropAddress": address_dto((s or {}).get("destination") or {}) if live and s else None,
        "description": ((s or {}).get("package") or {}).get("description") if live else None,
        "tripStatus": (trip or {}).get("status", "published"),
        "vehicle": {
            "registrationNumber": vehicle.get("registrationNumber") or (b.get("display") or {}).get("vehicleReg", ""),
            "vehicleClass": vehicle.get("vehicleClass", ""),
            "makeModel": vehicle.get("makeModel", ""),
        },
        "checkpoints": _brief(b, trip),
        "events": [event_dto(e, viewer_uid) for e in evs],
        "delivery": (
            {
                "at": iso_z((delivered or {}).get("at") or b.get("deliveredAt")),
                "proofUrls": [file_url(fid, viewer_uid) for fid in proof_ids(evs)],
                "remarks": (delivered or {}).get("remarks"),
            }
            if b.get("fulfilmentStatus") == "delivered"
            else None
        ),
        "cancellation": (
            {"at": iso_z(closure.get("at")), "note": closure.get("note"), "reason": closure.get("reason")}
            if closure
            else None
        ),
        "allowedActions": allowed_actions(b, trip),
    }


def history_item(b: Doc, s: Doc | None, proof_id: str | None, viewer_uid: str) -> dict[str, Any]:
    return {**shipment_list_item(b, s), "proofThumbUrl": file_url(proof_id, viewer_uid) if proof_id else None}


# ── trips ─────────────────────────────────────────────────────────────────────
def next_step(t: Doc) -> dict[str, Any] | None:
    if t.get("status") not in ("published", "in_progress"):
        return None
    cps = t.get("checkpoints") or []
    last = len(cps) - 1
    for c in cps:
        idx = int(c.get("index", 0))
        name = (c.get("place") or {}).get("name", "")
        if idx > 0 and not c.get("actualArrivalAt"):
            return {"kind": "arrive", "index": idx, "placeName": name, "expectedAt": iso_z(c.get("expectedArrivalAt"))}
        if idx < last and not c.get("actualDepartureAt"):
            return {
                "kind": "depart",
                "index": idx,
                "placeName": name,
                "expectedAt": iso_z(c.get("expectedDepartureAt")),
            }
    return None


def _capacity(t: Doc, now: Any) -> dict[str, int]:
    s = capacity.summary(t, now)
    return {
        "offeredKg": capacity.offered_kg(t),
        "bookedKg": s["committedKgMaxLeg"],
        "reservedKg": s["heldKgMaxLeg"],
        "availableKg": capacity.trip_available_kg(t, now),
    }


def trip_list_item(t: Doc, now: Any) -> dict[str, Any]:
    cps = t.get("checkpoints") or []
    origin = ((cps[0] if cps else {}).get("place") or {}).get("name", "")
    dest = ((cps[-1] if cps else {}).get("place") or {}).get("name", "")
    vehicle = t.get("vehicle") or {}
    holds = t.get("holds") or {}
    return {
        "id": t["id"],
        "status": t.get("status"),
        "routeLabel": f"{origin} → {dest}",
        "originName": origin,
        "destinationName": dest,
        "departureAt": iso_z(t.get("departureAt")),
        "arrivalAt": iso_z(t.get("arrivalAt")),
        "agencyName": t.get("agencyName", ""),
        "vehicle": {
            "registrationNumber": vehicle.get("registrationNumber", ""),
            "vehicleClass": vehicle.get("vehicleClass", ""),
            "makeModel": vehicle.get("makeModel", ""),
        },
        "capacity": _capacity(t, now),
        "checkpointCount": len(cps),
        "nextStep": next_step(t),
        "shipmentCount": sum(1 for h in holds.values() if h.get("state") == "committed")
        + int((t.get("counts") or {}).get("delivered", 0)),
    }


def trip_dto(
    t: Doc,
    bookings: Sequence[Doc],
    shipments: Mapping[str, Doc],
    events: Sequence[Doc],
    driver_id: str,
    now: Any,
) -> dict[str, Any]:
    visible = [
        b for b in bookings if b.get("driverId") == driver_id and b.get("paidAt") is not None and not b.get("closure")
    ]

    def ref(b: Doc) -> dict[str, Any]:
        return {
            "bookingId": b["id"],
            "customerName": (b.get("display") or {}).get("customerName", ""),
            "receiverName": ((shipments.get(b.get("shipmentId", "")) or {}).get("receiver") or {}).get("name"),
            "weightKg": int(b.get("weightKg", 0)),
            "status": derived(b)["status"],
        }

    cps = t.get("checkpoints") or []
    arrived_end = bool(cps and cps[-1].get("actualArrivalAt"))
    held = [b for b in visible if b.get("fulfilmentStatus") in ("not_started", *bm.ON_BOARD)]
    out_cps = []
    for c in cps:
        idx = int(c.get("index", 0))
        place = c.get("place") or {}
        loc = place.get("location") or {}
        out_cps.append(
            {
                "index": idx,
                "placeId": place.get("placeId"),
                "placeName": place.get("name", ""),
                "districtName": district_name_of(place),
                "state": place.get("state"),
                "lat": loc.get("lat"),
                "lng": loc.get("lng"),
                "serviceRadiusKm": float(c.get("serviceRadiusKm") or 10),
                "kmFromOrigin": float(c.get("kmFromOrigin") or 0),
                "expectedArrivalAt": iso_z(c.get("expectedArrivalAt")),
                "expectedDepartureAt": iso_z(c.get("expectedDepartureAt")),
                "actualArrivalAt": iso_z(c.get("actualArrivalAt")),
                "actualDepartureAt": iso_z(c.get("actualDepartureAt")),
                "pickups": [ref(b) for b in visible if int(b["pickup"]["checkpointIndex"]) == idx],
                "drops": [ref(b) for b in visible if int(b["drop"]["checkpointIndex"]) == idx],
            }
        )
    return {
        **trip_list_item(t, now),
        "routePolyline": (t.get("route") or {}).get("overviewPolyline", ""),
        "checkpoints": out_cps,
        "events": [
            {
                "id": e["id"],
                "type": e.get("type"),
                "checkpointIndex": e.get("checkpointIndex"),
                "at": iso_z(e.get("at")),
                "clientAt": iso_z(e.get("clientAt")),
                "remarks": e.get("remarks"),
            }
            for e in events
        ],
        "canComplete": t.get("status") == "in_progress" and arrived_end and not held,
        "startedAt": iso_z(t.get("startedAt")),
        "completedAt": iso_z(t.get("completedAt")),
    }


def photo_url(doc: Doc | None, viewer_uid: str) -> str | None:
    return ref_url((doc or {}).get("photo"), viewer_uid)


__all__ = [
    "address_dto",
    "allowed_actions",
    "event_dto",
    "history_item",
    "maps_url",
    "next_step",
    "photo_url",
    "shipment_dto",
    "shipment_list_item",
    "trip_dto",
    "trip_list_item",
]
