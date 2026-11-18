"""``shipments/{shp_*}`` access (no business rules). Owner: D4.

Indexes: ``shipments``: ``customerId ASC, status ASC, createdAt DESC`` and ``customerId ASC, createdAt DESC``.
"""

from __future__ import annotations

from typing import Any

from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, doc_ref, get_db, get_doc, query_docs, tx_get


async def get(shipment_id: str) -> dict[str, Any] | None:
    return await get_doc(C.shipments, shipment_id)


async def tx_get_shipment(tx: AsyncTransaction, shipment_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.shipments, shipment_id)


def tx_create(tx: AsyncTransaction, doc: dict[str, Any]) -> None:
    tx.create(doc_ref(C.shipments, doc["id"]), doc)


def tx_update(tx: AsyncTransaction, shipment_id: str, patch: dict[str, Any]) -> None:
    tx.update(doc_ref(C.shipments, shipment_id), patch)


async def create(doc: dict[str, Any]) -> None:
    await doc_ref(C.shipments, doc["id"]).create(doc)


async def list_for_customer(
    customer_id: str, *, statuses: list[str] | None = None, limit: int = 20, after_id: str | None = None
) -> list[dict[str, Any]]:
    q: Any = get_db().collection(C.shipments).where(filter=FieldFilter("customerId", "==", customer_id))
    if statuses:
        q = q.where(filter=FieldFilter("status", "in", statuses))
    q = q.order_by("createdAt", direction=firestore.Query.DESCENDING).order_by(
        "__name__", direction=firestore.Query.DESCENDING
    )
    if after_id:
        snap = await doc_ref(C.shipments, after_id).get()
        if snap.exists and (snap.to_dict() or {}).get("customerId") == customer_id:
            q = q.start_after(snap)
    return await query_docs(q.limit(limit))
