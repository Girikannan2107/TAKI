"""``payments/{pay_*}`` access (Firestore only, no business rules). Owner: D5.

Indexes needed (D3, ``firebase/firestore.indexes.json``):
- ``payments``: ``customerId ASC, createdAt DESC`` (customer history)
- ``payments``: ``bookingId ASC, createdAt DESC`` (open payments of a booking)
- ``payments``: ``agencyId ASC, status ASC, createdAt DESC`` (agency earnings)
- ``payments``: ``status ASC, updatedAt ASC`` (admin queue / sweep reconcile)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.models.payment import PaymentDoc
from app.repositories.base import C, doc_ref, get_db, get_doc, query_docs, tx_get


def _doc(data: dict[str, Any] | None) -> PaymentDoc | None:
    return PaymentDoc.from_firestore(data)


async def get(payment_id: str) -> PaymentDoc | None:
    return _doc(await get_doc(C.payments, payment_id))


async def tx_get_payment(tx: AsyncTransaction, payment_id: str) -> PaymentDoc | None:
    return _doc(await tx_get(tx, C.payments, payment_id))


async def tx_list_for_booking(tx: AsyncTransaction, booking_id: str) -> list[PaymentDoc]:
    q = get_db().collection(C.payments).where(filter=FieldFilter("bookingId", "==", booking_id))
    snaps = [s async for s in q.stream(transaction=tx)]
    out = [PaymentDoc.from_firestore({**(s.to_dict() or {}), "id": s.id}) for s in snaps]
    return sorted((p for p in out if p is not None), key=lambda p: p.created_at)


def tx_create(tx: AsyncTransaction, payment: PaymentDoc) -> None:
    tx.create(doc_ref(C.payments, payment.id), payment.to_firestore())


def tx_put(tx: AsyncTransaction, payment: PaymentDoc) -> None:
    tx.set(doc_ref(C.payments, payment.id), payment.to_firestore())


async def list_for_customer(customer_id: str, *, limit: int, after_id: str | None = None) -> list[PaymentDoc]:
    q = (
        get_db()
        .collection(C.payments)
        .where(filter=FieldFilter("customerId", "==", customer_id))
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .order_by("__name__", direction=firestore.Query.DESCENDING)
    )
    if after_id is not None:
        snap = await doc_ref(C.payments, after_id).get()
        if snap.exists and (snap.to_dict() or {}).get("customerId") == customer_id:
            q = q.start_after(snap)
    return [p for p in (_doc(d) for d in await query_docs(q.limit(limit))) if p is not None]


async def list_for_agency(agency_id: str, statuses: list[str], *, limit: int = 200) -> list[PaymentDoc]:
    q = (
        get_db()
        .collection(C.payments)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .where(filter=FieldFilter("status", "in", statuses))
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .limit(limit)
    )
    return [p for p in (_doc(d) for d in await query_docs(q)) if p is not None]


async def list_by_status_updated_before(status: str, before: datetime, *, limit: int) -> list[PaymentDoc]:
    """Sweep reconcile: e.g. ``pending`` payments not updated for 10 minutes."""
    q = (
        get_db()
        .collection(C.payments)
        .where(filter=FieldFilter("status", "==", status))
        .where(filter=FieldFilter("updatedAt", "<=", before))
        .order_by("updatedAt")
        .limit(limit)
    )
    return [p for p in (_doc(d) for d in await query_docs(q)) if p is not None]
