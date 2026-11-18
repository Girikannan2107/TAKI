"""``reviews/{bookingId}`` access (one review per delivered booking). Owner: D4.

Indexes: ``driverId ASC, createdAt DESC`` · ``agencyId ASC, createdAt DESC``.
"""

from __future__ import annotations

from typing import Any

from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, doc_ref, get_db, get_doc, query_docs, tx_get


async def get(booking_id: str) -> dict[str, Any] | None:
    return await get_doc(C.reviews, booking_id)


async def tx_get_review(tx: AsyncTransaction, booking_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.reviews, booking_id)


def tx_create(tx: AsyncTransaction, doc: dict[str, Any]) -> None:
    tx.create(doc_ref(C.reviews, doc["id"]), doc)


async def list_for(field: str, value: str, *, limit: int, after_id: str | None = None) -> list[dict[str, Any]]:
    q: Any = (
        get_db()
        .collection(C.reviews)
        .where(filter=FieldFilter(field, "==", value))
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
        .order_by("__name__", direction=firestore.Query.DESCENDING)
    )
    if after_id:
        snap = await doc_ref(C.reviews, after_id).get()
        if snap.exists and (snap.to_dict() or {}).get(field) == value:
            q = q.start_after(snap)
    return await query_docs(q.limit(limit))
