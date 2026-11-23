"""``bookings/{TAKI########}`` access (no business rules). Owner: D4.

Composite indexes (D3 ``firebase/firestore.indexes.json``):
``customerId, tab, updatedAt DESC`` · ``customerId, updatedAt DESC`` · ``agencyId, agencyTab, createdAt DESC`` ·
``agencyId, tripId, createdAt DESC`` · ``tripId, status`` · ``driverId, driverTab, updatedAt DESC`` ·
``driverId, status, deliveredAt DESC`` · ``approvalStatus, respondBy`` · ``reservationStatus, paymentDueAt`` ·
``driverId, tripId``.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, count, doc_ref, doc_to_dict, get_db, get_doc, query_docs, tx_get

DESC = firestore.Query.DESCENDING
OPEN_TABS = ["pending", "confirmed", "picked_up", "in_transit"]


async def get(booking_id: str) -> dict[str, Any] | None:
    return await get_doc(C.bookings, booking_id)


async def get_many_ordered(ids: Sequence[str]) -> list[dict[str, Any]]:
    """Existing bookings in ``ids`` order."""
    out: list[dict[str, Any]] = []
    for i in dict.fromkeys(x for x in ids if x):
        d = await get_doc(C.bookings, i)
        if d is not None:
            out.append(d)
    return out


async def tx_get_booking(tx: AsyncTransaction, booking_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.bookings, booking_id)


async def tx_taken(tx: AsyncTransaction, ids: Sequence[str]) -> set[str]:
    """Which candidate ids already exist (read inside the transaction)."""
    taken: set[str] = set()
    for i in ids:
        if (await doc_ref(C.bookings, i).get(transaction=tx)).exists:
            taken.add(i)
    return taken


def tx_create(tx: AsyncTransaction, doc: dict[str, Any]) -> None:
    tx.create(doc_ref(C.bookings, doc["id"]), doc)


def tx_update(tx: AsyncTransaction, booking_id: str, patch: dict[str, Any]) -> None:
    tx.update(doc_ref(C.bookings, booking_id), patch)


async def update(booking_id: str, patch: dict[str, Any]) -> None:
    await doc_ref(C.bookings, booking_id).update(patch)


async def tx_list_for_trip(tx: AsyncTransaction, trip_id: str, statuses: Sequence[str]) -> list[dict[str, Any]]:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("tripId", "==", trip_id))
        .where(filter=FieldFilter("status", "in", list(statuses)))
    )
    out = [doc_to_dict(s) async for s in q.stream(transaction=tx)]
    return sorted((d for d in out if d is not None), key=lambda d: d["id"])


async def list_for_trip(trip_id: str, statuses: Sequence[str] | None = None, limit: int = 200) -> list[dict[str, Any]]:
    q: Any = get_db().collection(C.bookings).where(filter=FieldFilter("tripId", "==", trip_id))
    if statuses:
        q = q.where(filter=FieldFilter("status", "in", list(statuses)))
    rows = await query_docs(q.limit(limit))
    return sorted(rows, key=lambda d: (d.get("createdAt"), d["id"]))


async def _page(q: Any, *, limit: int, after_id: str | None, owner_field: str, owner: str) -> list[dict[str, Any]]:
    if after_id:
        snap = await doc_ref(C.bookings, after_id).get()
        if snap.exists and (snap.to_dict() or {}).get(owner_field) == owner:
            q = q.start_after(snap)
    return await query_docs(q.limit(limit))


async def list_for_customer(
    customer_id: str, *, tabs: Sequence[str] | None = None, limit: int = 20, after_id: str | None = None
) -> list[dict[str, Any]]:
    q: Any = get_db().collection(C.bookings).where(filter=FieldFilter("customerId", "==", customer_id))
    if tabs:
        flt = FieldFilter("tab", "in", list(tabs)) if len(tabs) > 1 else FieldFilter("tab", "==", tabs[0])
        q = q.where(filter=flt)
    q = q.order_by("updatedAt", direction=DESC).order_by("__name__", direction=DESC)
    return await _page(q, limit=limit, after_id=after_id, owner_field="customerId", owner=customer_id)


async def count_for_customer(customer_id: str, tab: str) -> int:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("customerId", "==", customer_id))
        .where(filter=FieldFilter("tab", "==", tab))
    )
    return await count(q)


async def list_open_for_customer(customer_id: str, limit: int = 200) -> list[dict[str, Any]]:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("customerId", "==", customer_id))
        .where(filter=FieldFilter("tab", "in", OPEN_TABS))
        .limit(limit)
    )
    return await query_docs(q)


async def list_for_agency(
    agency_id: str, *, tab: str | None = None, trip_id: str | None = None, limit: int = 20, after_id: str | None = None
) -> list[dict[str, Any]]:
    q: Any = get_db().collection(C.bookings).where(filter=FieldFilter("agencyId", "==", agency_id))
    if trip_id:
        q = q.where(filter=FieldFilter("tripId", "==", trip_id))
    if tab:
        q = q.where(filter=FieldFilter("agencyTab", "==", tab))
    q = q.order_by("createdAt", direction=DESC).order_by("__name__", direction=DESC)
    return await _page(q, limit=limit, after_id=after_id, owner_field="agencyId", owner=agency_id)


async def count_for_agency(agency_id: str, tab: str) -> int:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .where(filter=FieldFilter("agencyTab", "==", tab))
    )
    return await count(q)


async def list_for_driver(
    driver_id: str, *, tab: str, limit: int = 20, after_id: str | None = None
) -> list[dict[str, Any]]:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("driverId", "==", driver_id))
        .where(filter=FieldFilter("driverTab", "==", tab))
        .order_by("updatedAt", direction=DESC)
        .order_by("__name__", direction=DESC)
    )
    return await _page(q, limit=limit, after_id=after_id, owner_field="driverId", owner=driver_id)


async def count_for_driver(driver_id: str, tab: str) -> int:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("driverId", "==", driver_id))
        .where(filter=FieldFilter("driverTab", "==", tab))
    )
    return await count(q)


async def list_delivered_for_driver(driver_id: str, *, limit: int, after_id: str | None = None) -> list[dict[str, Any]]:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("driverId", "==", driver_id))
        .where(filter=FieldFilter("status", "==", "delivered"))
        .order_by("deliveredAt", direction=DESC)
        .order_by("__name__", direction=DESC)
    )
    return await _page(q, limit=limit, after_id=after_id, owner_field="driverId", owner=driver_id)


async def list_for_driver_trip(driver_id: str, trip_id: str) -> list[dict[str, Any]]:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("driverId", "==", driver_id))
        .where(filter=FieldFilter("tripId", "==", trip_id))
        .limit(200)
    )
    return await query_docs(q)


async def list_due_requests(now: datetime, limit: int) -> list[dict[str, Any]]:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("approvalStatus", "==", "pending"))
        .where(filter=FieldFilter("respondBy", "<=", now))
        .order_by("respondBy")
        .limit(limit)
    )
    return await query_docs(q)


async def list_due_payments(now: datetime, limit: int) -> list[dict[str, Any]]:
    q = (
        get_db()
        .collection(C.bookings)
        .where(filter=FieldFilter("reservationStatus", "==", "held"))
        .where(filter=FieldFilter("paymentDueAt", "<=", now))
        .order_by("paymentDueAt")
        .limit(limit)
    )
    return await query_docs(q)
