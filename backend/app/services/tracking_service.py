"""Tracking (P2 §13.1): driver checkpoint arrive / depart / complete with booking fan-out, and the
read models every role uses (customer bookings + tracking, agency bookings, driver app). Owner: D4.

Every role reads the same ordered, timestamped ``bookings/{id}/events`` list, so status stays in
sync. ``at`` is server time; ``clientAt`` is the driver's device time (audit only). No positions are
collected and ``liveLocation`` is always ``null``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.ids import new_id
from app.core.pagination import decode_cursor, encode_cursor
from app.core.time import IST
from app.domain import booking_machine as bm
from app.domain import capacity
from app.repositories import booking_secrets as secrets_repo
from app.repositories import bookings as bookings_repo
from app.repositories import events as events_repo
from app.repositories import payments as payments_repo
from app.repositories import reviews as reviews_repo
from app.repositories.base import C, doc_ref, get_db, get_doc, query_docs, run_transaction, tx_get
from app.services import booking_service as bs
from app.services import notification_service
from app.services.notification_service import notify_many
from app.views import bookings as vb
from app.views import customer as vc
from app.views import driver as vd

TRIP_FILTERS = {"upcoming": ["published"], "active": ["in_progress"], "completed": ["completed"]}


# ── helpers ───────────────────────────────────────────────────────────────────
async def ensure_driver_linked(user: CurrentUser) -> dict[str, Any]:
    d = await get_doc(C.drivers, user.uid)
    link = (d or {}).get("agencyLink") or {}
    if d is None or link.get("status") != "active":
        raise AppError("driver_not_linked")
    return d


def _own_trip(user: CurrentUser, trip: dict[str, Any] | None) -> dict[str, Any]:
    if trip is None or trip.get("driverId") != user.uid or trip.get("status") == "draft":
        raise AppError("not_found")
    return trip


async def _latest_payment(b: dict[str, Any]) -> Any:
    if b.get("paymentId"):
        p = await payments_repo.get(b["paymentId"])
        if p is not None:
            return p
    return None


def _trip_event(trip_id: str, type_: str, now: datetime, by: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "id": new_id("tev"),
        "tripId": trip_id,
        "type": type_,
        "checkpointIndex": extra.get("checkpoint_index"),
        "at": now,
        "clientAt": extra.get("client_at"),
        "actor": dict(by),
        "remarks": extra.get("remarks"),
    }


# ── E89 / E90 checkpoint arrive / depart ──────────────────────────────────────
async def checkpoint(
    user: CurrentUser,
    trip_id: str,
    index: int,
    kind: Literal["arrive", "depart"],
    *,
    remarks: str | None,
    client_at: datetime | None,
    now: datetime,
) -> list[str]:
    text = (remarks or "").strip() or None
    if text and len(text) > 300:
        raise AppError("invalid_request", fields={"remarks": "Keep remarks under 300 characters"})
    by = bs.actor_of(user)

    async def fn(tx: AsyncTransaction) -> list[str]:
        trip = _own_trip(user, await tx_get(tx, C.trips, trip_id))
        agency = await tx_get(tx, C.agencies, trip.get("agencyId", ""))
        tb = await bs.load_trip_bookings(tx, trip_id, now=now)
        cps = list(trip.get("checkpoints") or [])
        last = len(cps) - 1
        if not 0 <= index <= last:
            raise AppError("not_found")
        if (kind == "arrive" and index == 0) or (kind == "depart" and index == last):
            raise AppError("invalid_transition", "The origin has no arrival and the destination no departure.")
        cp = cps[index]
        if cp.get("actualArrivalAt" if kind == "arrive" else "actualDepartureAt"):
            return []  # idempotent
        expected = vd.next_step(trip) if trip.get("status") in ("published", "in_progress") else None
        if index == 0:
            if trip.get("status") != "published":
                raise AppError("invalid_transition", "This trip isn't ready to start.")
            if now < trip["departureAt"] - bm.TRIP_START_WINDOW:
                raise AppError("too_early", "You can start this trip up to 2 hours before departure.")
        elif trip.get("status") != "in_progress":
            raise AppError("invalid_transition", "Start the trip first.")
        if expected is None or expected["index"] != index or expected["kind"] != kind:
            raise AppError(
                "checkpoint_out_of_order",
                details={"expected": {"kind": expected["kind"], "index": expected["index"]} if expected else None},
            )
        # Lazy expiry of every lapsed request / unpaid hold on the trip (one trip write at the end).
        cur = dict(trip)
        job_ids: list[str] = []
        for bundle in tb.bundles:
            bundle.trip = cur
            bundle.agency = agency
            _, jobs = await bs._expire_if_due(tx, bundle, now, write_trip=False)  # noqa: SLF001 - same package
            if bundle.trip is not None:
                cur = bundle.trip
            job_ids += jobs
        place_name = (cp.get("place") or {}).get("name", "")
        new_cps = [dict(c) for c in cps]
        new_cps[index]["actualArrivalAt" if kind == "arrive" else "actualDepartureAt"] = now
        nxt_trip = {**cur, "checkpoints": new_cps}
        step = vd.next_step({**nxt_trip, "status": "in_progress"})
        patch: dict[str, Any] = {
            "checkpoints": new_cps,
            "progress": {
                "lastCheckpointIndex": index,
                "lastEventAt": now,
                "nextStep": {"kind": step["kind"], "index": step["index"]} if step else None,
            },
            "holds": capacity.holds_of(cur),
            "counts": cur.get("counts") or {},
            "capacitySummary": capacity.summary(cur, now),
            "updatedAt": now,
            "version": int(trip.get("version", 0)) + 1,
        }
        if index == 0:
            patch.update({"status": "in_progress", "startedAt": now})
        tx.update(doc_ref(C.trips, trip_id), patch)
        live = [b.booking for b in tb.bundles if not b.booking.get("closure")]
        notes = bs.tx_checkpoint_fanout(
            tx, live, index=index, kind=kind, place_name=place_name, by=by, client_at=client_at, now=now
        )
        ev_type = "started" if index == 0 else ("checkpoint_arrived" if kind == "arrive" else "checkpoint_departed")
        events_repo.tx_add_trip_event(
            tx, _trip_event(trip_id, ev_type, now, by, checkpoint_index=index, remarks=text, client_at=client_at)
        )
        notify_many(tx, notes, now)
        return job_ids

    return await run_transaction(fn)


# ── E91 complete ──────────────────────────────────────────────────────────────
async def complete_trip(user: CurrentUser, trip_id: str, *, now: datetime) -> list[str]:
    from app.services import trip_service  # D3: driver/vehicle schedule release

    by = bs.actor_of(user)

    async def fn(tx: AsyncTransaction) -> list[str]:
        trip = _own_trip(user, await tx_get(tx, C.trips, trip_id))
        agency = await tx_get(tx, C.agencies, trip.get("agencyId", ""))
        tb = await bs.load_trip_bookings(tx, trip_id, now=now)
        schedules = await trip_service.tx_read_schedules(tx, trip)
        if trip.get("status") == "completed":
            return []
        if trip.get("status") != "in_progress":
            raise AppError("invalid_transition", "Start the trip first.")
        cps = trip.get("checkpoints") or []
        if not cps or not cps[-1].get("actualArrivalAt"):
            raise AppError("invalid_transition", "Arrive at the final checkpoint first.")
        if any(
            b.get("paymentStatus") == "paid"
            and not b.get("closure")
            and b.get("fulfilmentStatus") in ("not_started", *bm.ON_BOARD)
            for b in tb.bookings
        ):
            raise AppError("undelivered_shipments")
        cur = dict(trip)
        job_ids: list[str] = []
        for bundle in tb.bundles:
            bundle.trip = cur
            bundle.agency = agency
            b = bundle.booking
            if b.get("closure"):
                continue
            event = "expire_request" if b.get("approvalStatus") == "pending" else "expire_payment"
            if event == "expire_payment" and b.get("paymentStatus") not in bm.PAYABLE:
                continue
            out = await bs._close(tx, bundle, event, bs.SYSTEM, now, note="The trip has finished.", write_trip=False)  # noqa: SLF001
            if bundle.trip is not None:
                cur = bundle.trip
            job_ids += out.job_ids
            if out.changed:
                notify_many(tx, bs._expiry_notes(bundle, event), now)  # noqa: SLF001
        trip_service.tx_release_schedules(tx, trip, schedules, now)
        tx.update(
            doc_ref(C.trips, trip_id),
            {
                "status": "completed",
                "completedAt": now,
                "searchKeys": [],
                "holds": capacity.holds_of(cur),
                "counts": cur.get("counts") or {},
                "capacitySummary": capacity.summary(cur, now),
                "progress": {**(trip.get("progress") or {}), "nextStep": None, "lastEventAt": now},
                "updatedAt": now,
                "version": int(trip.get("version", 0)) + 1,
            },
        )
        events_repo.tx_add_trip_event(tx, _trip_event(trip_id, "completed", now, by))
        return job_ids

    return await run_transaction(fn)


# ── driver read side (E86–E88, E92, E93, E100) ────────────────────────────────
async def _driver_trips(uid: str, statuses: list[str], limit: int = 50) -> list[dict[str, Any]]:
    q = (
        get_db()
        .collection(C.trips)
        .where(filter=FieldFilter("driverId", "==", uid))
        .where(filter=FieldFilter("status", "in", statuses))
        .order_by("departureAt")
        .limit(limit)
    )
    return await query_docs(q)


async def driver_trips(user: CurrentUser, status: str, *, now: datetime) -> dict[str, Any]:
    await ensure_driver_linked(user)
    rows = await _driver_trips(user.uid, TRIP_FILTERS[status])
    if status == "completed":
        rows = sorted(rows, key=lambda t: t["departureAt"], reverse=True)
    return {"items": [vd.trip_list_item(t, now) for t in rows]}


async def driver_trip(user: CurrentUser, trip_id: str, *, now: datetime) -> dict[str, Any]:
    await ensure_driver_linked(user)
    trip = _own_trip(user, await get_doc(C.trips, trip_id) if trip_id.startswith("trp_") else None)
    rows = await bookings_repo.list_for_driver_trip(user.uid, trip_id)
    shipments = {}
    for b in rows:
        s = await get_doc(C.shipments, b.get("shipmentId", ""))
        if s is not None:
            shipments[s["id"]] = s
    events = await events_repo.list_trip_events(trip_id)
    return vd.trip_dto(trip, rows, shipments, events, user.uid, now)


async def driver_dashboard(user: CurrentUser, *, now: datetime) -> dict[str, Any]:
    d = await get_doc(C.drivers, user.uid) or {}
    link = d.get("agencyLink") or None
    approved = bool(link and link.get("status") == "active")
    base: dict[str, Any] = {
        "driver": {"fullName": d.get("fullName", user.name), "photoUrl": vd.photo_url(d, user.uid)},
        "agency": {
            "agencyId": link.get("agencyId"),
            "agencyName": link.get("agencyName", ""),
            "status": link.get("status"),
        }
        if link
        else None,
        "approved": approved,
        "activeTrips": 0,
        "pendingPickups": 0,
        "inTransit": 0,
        "completedDeliveries": 0,
        "nextTrip": None,
        "nextActions": [],
    }
    if not approved:
        return base
    active = await _driver_trips(user.uid, ["in_progress"], 10)
    upcoming = await _driver_trips(user.uid, ["published"], 10)
    pending = await bookings_repo.list_for_driver(user.uid, tab="pending_pickup", limit=50)
    pending = sorted(pending, key=lambda b: b["pickup"]["expectedDepartureAt"])[:5]
    actions = []
    for b in pending:
        actions.append(vd.shipment_list_item(b, await get_doc(C.shipments, b.get("shipmentId", ""))))
    nxt = (active or upcoming or [None])[0]
    base.update(
        {
            "activeTrips": len(active),
            "pendingPickups": await bookings_repo.count_for_driver(user.uid, "pending_pickup"),
            "inTransit": await bookings_repo.count_for_driver(user.uid, "in_transit"),
            "completedDeliveries": await bookings_repo.count_for_driver(user.uid, "delivered"),
            "nextTrip": vd.trip_list_item(nxt, now) if nxt else None,
            "nextActions": actions,
        }
    )
    return base


async def driver_shipments(user: CurrentUser, tab: str, *, limit: int, cursor: str | None) -> dict[str, Any]:
    await ensure_driver_linked(user)
    c = decode_cursor(cursor)
    after = str(c.get("id", "")) if c else None
    rows = await bookings_repo.list_for_driver(user.uid, tab=tab, limit=limit + 1, after_id=after)
    page = rows[:limit]
    items = [vd.shipment_list_item(b, await get_doc(C.shipments, b.get("shipmentId", ""))) for b in page]
    return {"items": items, "nextCursor": encode_cursor({"id": page[-1]["id"]}) if len(rows) > limit and page else None}


async def driver_shipment(user: CurrentUser, booking_id: str) -> dict[str, Any]:
    await ensure_driver_linked(user)
    b = await bookings_repo.get(booking_id) if booking_id.startswith("TAKI") else None
    if not bs.driver_can_see(b, user.uid):
        raise AppError("not_found")
    assert b is not None  # noqa: S101
    s = await get_doc(C.shipments, b.get("shipmentId", ""))
    trip = await get_doc(C.trips, b.get("tripId", ""))
    events = await events_repo.list_booking_events(b["id"])
    customer = await get_doc(C.customers, b.get("customerId", ""))
    phone = (customer or {}).get("phone") or (b.get("display") or {}).get("customerPhone")
    return vd.shipment_dto(b, s, trip, events, customer_phone=phone, viewer_uid=user.uid)


async def driver_history(
    user: CurrentUser, *, q: str | None, month: str | None, limit: int, cursor: str | None
) -> dict[str, Any]:
    await ensure_driver_linked(user)
    c = decode_cursor(cursor)
    after = str(c.get("id", "")) if c else None
    needle = (q or "").strip().upper()
    items: list[dict[str, Any]] = []
    last_id: str | None = None
    more = False
    scanned = 0
    while len(items) < limit and scanned < 500:
        rows = await bookings_repo.list_delivered_for_driver(user.uid, limit=50, after_id=after)
        if not rows:
            break
        for b in rows:
            scanned += 1
            after = b["id"]
            if needle and needle not in b["id"]:
                continue
            if month and (b.get("deliveredAt") is None or b["deliveredAt"].astimezone(IST).strftime("%Y-%m") != month):
                continue
            if len(items) == limit:
                more = True
                break
            events = await events_repo.list_booking_events(b["id"])
            proof = vb.proof_ids(events)
            items.append(
                vd.history_item(
                    b, await get_doc(C.shipments, b.get("shipmentId", "")), proof[0] if proof else None, user.uid
                )
            )
            last_id = b["id"]
        if more or len(rows) < 50:
            break
    return {"items": items, "nextCursor": encode_cursor({"id": last_id}) if more and last_id else None}


# ── customer read side (E25, E35–E37, E40) ────────────────────────────────────
async def customer_booking(user: CurrentUser, booking_id: str, *, now: datetime) -> dict[str, Any]:
    b = await bookings_repo.get(booking_id) if booking_id.startswith("TAKI") else None
    if b is None or user.role != "customer" or b.get("customerId") != user.uid:
        raise AppError("not_found")
    shipment = await get_doc(C.shipments, b["shipmentId"])
    trip = await get_doc(C.trips, b["tripId"])
    if shipment is None or trip is None:
        raise AppError("not_found")
    agency = await get_doc(C.agencies, b.get("agencyId", ""))
    driver = await get_doc(C.drivers, b.get("driverId") or "") if b.get("driverId") else None
    secrets = await secrets_repo.get(b["id"]) if b.get("paymentStatus") == "paid" else None
    review = await reviews_repo.get(b["id"]) if b.get("reviewed") else None
    return vc.customer_booking_dto(
        b,
        shipment=shipment,
        trip=trip,
        agency=agency,
        driver=driver,
        payment=await _latest_payment(b),
        secrets=secrets,
        review=review,
        viewer_uid=user.uid,
        now=now,
        decrypt=bs.decrypt_otp,
    )


async def lazy_expire(booking_id: str, now: datetime) -> list[str]:
    """Contract §15.1: reads (E37, E81, E93) apply a due expiry first."""
    b = await bookings_repo.get(booking_id) if booking_id.startswith("TAKI") else None
    if b is None or b.get("closure"):
        return []
    trip = await get_doc(C.trips, b.get("tripId", ""))
    if bs.due_expiry(bs.Bundle(b, trip, None, None, []), now) is None:
        return []
    _, jobs = await bs.expire_if_due(booking_id, now)
    return jobs


async def customer_bookings(
    user: CurrentUser, *, tab: str | None, active: bool, limit: int, cursor: str | None
) -> dict[str, Any]:
    c = decode_cursor(cursor)
    after = str(c.get("id", "")) if c else None
    tabs = [tab] if tab else (list(bookings_repo.OPEN_TABS) if active else None)
    rows = await bookings_repo.list_for_customer(user.uid, tabs=tabs, limit=limit + 1, after_id=after)
    page = rows[:limit]
    items = [vc.booking_list_item(b, await get_doc(C.trips, b.get("tripId", ""))) for b in page]
    return {"items": items, "nextCursor": encode_cursor({"id": page[-1]["id"]}) if len(rows) > limit and page else None}


async def customer_counts(user: CurrentUser) -> dict[str, int]:
    return {t: await bookings_repo.count_for_customer(user.uid, t) for t in bm.CUSTOMER_TABS}


async def customer_tracking(user: CurrentUser, booking_id: str) -> dict[str, Any]:
    b = await bookings_repo.get(booking_id) if booking_id.startswith("TAKI") else None
    if b is None or user.role != "customer" or b.get("customerId") != user.uid:
        raise AppError("not_found")
    trip = await get_doc(C.trips, b["tripId"])
    if trip is None:
        raise AppError("not_found")
    return vc.tracking_dto(b, trip, await events_repo.list_booking_events(b["id"]), user.uid)


async def customer_dashboard(user: CurrentUser, *, now: datetime) -> dict[str, Any]:
    from app.services import shipment_service

    customer = await get_doc(C.customers, user.uid) or {}
    name = str(customer.get("fullName") or user.name)
    active = await bookings_repo.list_for_customer(user.uid, tabs=list(bookings_repo.OPEN_TABS), limit=5)
    return {
        "firstName": name.split()[0] if name.split() else name,
        "counts": await customer_counts(user),
        "active": [vc.booking_list_item(b, await get_doc(C.trips, b.get("tripId", ""))) for b in active],
        "openShipments": await shipment_service.open_shipments(user),
        "recentActivity": await notification_service.recent(user.uid, 5),
    }


# ── agency read side (E80, E81) ───────────────────────────────────────────────
def _agency_id(user: CurrentUser) -> str:
    if user.role != "agency" or not user.agency_id:
        raise AppError("forbidden")
    return user.agency_id


async def agency_counts(agency_id: str) -> dict[str, int]:
    return {t: await bookings_repo.count_for_agency(agency_id, t) for t in bm.AGENCY_TABS}


async def agency_bookings(
    user: CurrentUser, *, tab: str, trip_id: str | None, limit: int, cursor: str | None, now: datetime
) -> dict[str, Any]:
    agency_id = _agency_id(user)
    c = decode_cursor(cursor)
    after = str(c.get("id", "")) if c else None
    rows = await bookings_repo.list_for_agency(agency_id, tab=tab, trip_id=trip_id, limit=limit + 1, after_id=after)
    page = rows[:limit]
    trips: dict[str, dict[str, Any] | None] = {}
    items = []
    for b in page:
        tid = b.get("tripId", "")
        if tid not in trips:
            trips[tid] = await get_doc(C.trips, tid)
        items.append(vb.agency_list_item(b, trips[tid], now))
    return {
        "items": items,
        "nextCursor": encode_cursor({"id": page[-1]["id"]}) if len(rows) > limit and page else None,
        "counts": await agency_counts(agency_id),
    }


async def agency_booking(user: CurrentUser, booking_id: str, *, now: datetime) -> dict[str, Any]:
    agency_id = _agency_id(user)
    b = await bookings_repo.get(booking_id) if booking_id.startswith("TAKI") else None
    if b is None or b.get("agencyId") != agency_id:
        raise AppError("not_found")
    shipment = await get_doc(C.shipments, b.get("shipmentId", ""))
    trip = await get_doc(C.trips, b.get("tripId", ""))
    customer = await get_doc(C.customers, b.get("customerId", "")) if b.get("approvalStatus") == "accepted" else None
    return vb.agency_booking_dto(
        b,
        shipment=shipment,
        trip=trip,
        customer=customer,
        payment=await _latest_payment(b),
        events=await events_repo.list_booking_events(b["id"]),
        viewer_uid=user.uid,
        now=now,
    )


__all__ = [
    "agency_booking",
    "agency_bookings",
    "agency_counts",
    "checkpoint",
    "complete_trip",
    "customer_booking",
    "customer_bookings",
    "customer_counts",
    "customer_dashboard",
    "customer_tracking",
    "driver_dashboard",
    "driver_history",
    "driver_shipment",
    "driver_shipments",
    "driver_trip",
    "driver_trips",
    "ensure_driver_linked",
    "lazy_expire",
]
