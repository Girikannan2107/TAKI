"""Booking projections shared by every role, plus the agency booking DTOs (P2 §12.3). Owner: D4.

The ONLY code that turns booking documents into agency JSON. Visibility (agency):

* place names, district, weight, goods, description, date — from the request;
* customer name — from the request; customer phone and full addresses — from ``accepted``;
* receiver name and phone — once paid;
* pricing breakdown — always; OTPs — never.

D3 uses :func:`agency_list_item` for ``AgencyTripDTO.bookings``.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from app.core.time import iso_z
from app.domain import booking_machine as bm
from app.domain import capacity
from app.schemas.common import district_name_of
from app.views.common import file_url

Doc = Mapping[str, Any]


def closure_dto(c: Doc | None) -> dict[str, Any] | None:
    if not c:
        return None
    return {
        "kind": c.get("kind"),
        "reason": c.get("reason"),
        "note": c.get("note"),
        "at": iso_z(c.get("at")),
        "byRole": (c.get("by") or {}).get("role"),
    }


def state_dto(b: Doc) -> dict[str, Any]:
    return {
        "approvalStatus": b.get("approvalStatus"),
        "paymentStatus": b.get("paymentStatus"),
        "reservationStatus": b.get("reservationStatus"),
        "fulfilmentStatus": b.get("fulfilmentStatus"),
        "closure": closure_dto(b.get("closure")),
    }


def derived(b: Doc) -> dict[str, Any]:
    """Always recomputed from the four machines (never trusts a stale stored ``status``)."""
    return bm.derive(b)


def payment_summary(p: Any | None) -> dict[str, Any] | None:
    """``PaymentSummaryDTO`` from a D5 ``PaymentDoc``."""
    if p is None:
        return None
    refund = None
    if p.refund is not None:
        refund = {
            "status": p.refund.status,
            "amountRupees": round(p.refund.amount_paise / 100),
            "completedAt": iso_z(p.refund.completed_at),
        }
    return {
        "id": p.id,
        "status": p.status,
        "provider": "cashfree" if p.provider == "cashfree" else p.provider,
        "amountRupees": p.amount_rupees,
        "methodLabel": p.method_label,
        "paidAt": iso_z(p.paid_at),
        "refund": refund,
        "testPayment": bool(getattr(p, "test_payment", False)),
    }


def review_dto(r: Doc | None) -> dict[str, Any] | None:
    if not r:
        return None
    return {
        "id": r["id"],
        "bookingId": r.get("bookingId", r["id"]),
        "rating": int(r.get("rating", 0)),
        "comment": r.get("comment"),
        "customerFirstName": r.get("customerFirstName", ""),
        "createdAt": iso_z(r.get("createdAt")),
    }


def accepted_on(b: Doc) -> bool:
    """Agency accepted (driver identity / registration / customer phone shared)."""
    return b.get("approvalStatus") == "accepted"


def paid_on(b: Doc) -> bool:
    return b.get("paidAt") is not None


def contacts_live(b: Doc) -> bool:
    """Paid and goods not yet delivered / refused / closed (phones are shared only in this window)."""
    return (
        b.get("paymentStatus") == "paid"
        and not b.get("closure")
        and b.get("fulfilmentStatus") in ("not_started", "picked_up", "in_transit", "out_for_delivery")
    )


def visible_events(events: Iterable[Doc], role: str) -> list[Doc]:
    return [e for e in events if role in (e.get("visibility") or ("customer", "agency", "driver"))]


def event_files(e: Doc) -> list[str]:
    return [str(f.get("fileId")) for f in (e.get("files") or []) if f.get("fileId")]


def proof_ids(events: Iterable[Doc]) -> list[str]:
    out: dict[str, None] = {}
    for e in events:
        if e.get("type") in ("delivered", "delivery_proof_added"):
            for fid in event_files(e):
                out[fid] = None
    return list(out)


# ── agency ────────────────────────────────────────────────────────────────────
def _stop(b: Doc, which: str, trip: Doc | None) -> dict[str, Any]:
    s = b.get(which) or {}
    cp = None
    if trip is not None:
        cps = trip.get("checkpoints") or []
        idx = s.get("checkpointIndex")
        cp = cps[idx] if isinstance(idx, int) and 0 <= idx < len(cps) else None
    district = s.get("district") or (district_name_of((cp or {}).get("place")) if cp else "") or s.get("placeName", "")
    out = {
        "checkpointIndex": s.get("checkpointIndex"),
        "placeName": s.get("placeName", ""),
        "districtName": district,
    }
    key = "expectedDepartureAt" if which == "pickup" else "expectedArrivalAt"
    out[key] = iso_z(s.get(key))
    return out


def agency_list_item(b: Doc, trip: Doc | None, now: datetime) -> dict[str, Any]:
    d = b.get("display") or {}
    pricing = b.get("pricing") or {}
    der = derived(b)
    cap = None
    if der["status"] == "awaiting_agency" and trip is not None:
        try:
            i, j = int(b["pickup"]["checkpointIndex"]), int(b["drop"]["checkpointIndex"])
            avail = capacity.available_kg(trip, i, j, now, b["id"])
            cap = {"availableKg": avail, "afterAcceptKg": max(0, avail - int(b.get("weightKg", 0)))}
        except (KeyError, TypeError, ValueError):
            cap = None
    return {
        "id": b["id"],
        "status": der["status"],
        "tab": der["agencyTab"],
        "state": state_dto(b),
        "matchType": b.get("matchType", "exact"),
        "tripId": b.get("tripId"),
        "customerName": d.get("customerName", ""),
        "pickup": _stop(b, "pickup", trip),
        "drop": _stop(b, "drop", trip),
        "weightKg": int(b.get("weightKg", 0)),
        "goodsCategory": b.get("goodsCategory"),
        "specialHandling": list(b.get("specialHandling") or []),
        "tripDepartureAt": iso_z(d.get("tripDepartureAt")),
        "vehicleReg": d.get("vehicleReg") or "",
        "driverName": d.get("driverName") or "",
        "routeLabel": d.get("routeLabel") or "",
        "earnings": int(pricing.get("agencyNet", 0)),
        "totalPayable": int(pricing.get("totalPayable", 0)),
        "respondBy": iso_z(b.get("respondBy")),
        "paymentDueAt": iso_z(b.get("paymentDueAt")),
        "capacity": cap,
        "createdAt": iso_z(b.get("createdAt")),
        "updatedAt": iso_z(b.get("updatedAt")),
    }


def _address_line(a: Doc | None) -> str | None:
    if not a:
        return None
    return ", ".join(x for x in (a.get("line1"), a.get("line2"), a.get("landmark")) if x)


def _agency_address(a: Doc | None, full: bool) -> dict[str, Any]:
    a = a or {}
    place = a.get("place") or {}
    loc = place.get("location") or {}
    return {
        "line": _address_line(a) if full else None,
        "districtName": district_name_of(place),
        "state": a.get("state") or place.get("state"),
        "pincode": a.get("pincode") if full else None,
        "lat": loc.get("lat") if full else None,
        "lng": loc.get("lng") if full else None,
    }


def timeline(events: Iterable[Doc], viewer_uid: str, role: str) -> list[dict[str, Any]]:
    return [
        {
            "id": e.get("id"),
            "type": e.get("type"),
            "at": iso_z(e.get("at")),
            "clientAt": iso_z(e.get("clientAt")),
            "placeName": e.get("placeName"),
            "remarks": e.get("remarks"),
            "proofUrls": [file_url(fid, viewer_uid) for fid in event_files(e)],
            "byRole": (e.get("actor") or {}).get("role", "system"),
        }
        for e in visible_events(events, role)
    ]


def agency_booking_dto(
    b: Doc,
    *,
    shipment: Doc | None,
    trip: Doc | None,
    customer: Doc | None,
    payment: Any | None,
    events: list[Doc],
    viewer_uid: str,
    now: datetime,
) -> dict[str, Any]:
    accepted = accepted_on(b)
    paid = paid_on(b)
    d = b.get("display") or {}
    s = shipment or {}
    pkg = s.get("package") or {}
    closure = b.get("closure") or {}
    der = derived(b)
    customer_phone = (customer or {}).get("phone") or d.get("customerPhone")
    receiver = s.get("receiver") or {}
    return {
        **agency_list_item(b, trip, now),
        "customer": {"name": d.get("customerName", ""), "phone": customer_phone if accepted and not closure else None},
        "receiver": {"name": receiver.get("name", ""), "phone": receiver.get("phone")} if paid else None,
        "addresses": {
            "pickup": _agency_address(s.get("source"), accepted),
            "drop": _agency_address(s.get("destination"), accepted),
        },
        "package": {
            "weightKg": int(pkg.get("weightKg", b.get("weightKg", 0))),
            "goodsCategory": pkg.get("goodsCategory", b.get("goodsCategory")),
            "packageType": pkg.get("packageType", "other"),
            "description": pkg.get("description", ""),
            "pieces": int(pkg.get("pieces", 1)),
            "specialHandling": list(pkg.get("specialHandling") or b.get("specialHandling") or []),
            "declaredValueRupees": pkg.get("declaredValueRupees"),
        },
        "shippingDate": s.get("shippingDate"),
        "pricing": b.get("pricing"),
        "payment": (
            {
                "status": payment.status,
                "amountRupees": payment.amount_rupees,
                "methodLabel": payment.method_label,
                "paidAt": iso_z(payment.paid_at),
            }
            if payment is not None
            else None
        ),
        "trip": (
            {
                "id": trip["id"],
                "status": trip.get("status"),
                "routeLabel": d.get("routeLabel", ""),
                "departureAt": iso_z(trip.get("departureAt")),
                "vehicleReg": d.get("vehicleReg") or "",
                "driverName": d.get("driverName") or "",
            }
            if trip is not None
            else None
        ),
        "rejection": (
            {"reason": closure.get("reason"), "note": closure.get("note"), "at": iso_z(closure.get("at"))}
            if der["status"] == "rejected"
            else None
        ),
        "cancellation": (
            {"reason": closure.get("reason"), "note": closure.get("note"), "at": iso_z(closure.get("at"))}
            if der["status"] == "cancelled"
            else None
        ),
        "timeline": timeline(events, viewer_uid, "agency"),
        "sharedWithDriver": paid and contacts_live(b),
    }


__all__ = [
    "accepted_on",
    "agency_booking_dto",
    "agency_list_item",
    "closure_dto",
    "contacts_live",
    "derived",
    "event_files",
    "paid_on",
    "payment_summary",
    "proof_ids",
    "review_dto",
    "state_dto",
    "timeline",
    "visible_events",
]
