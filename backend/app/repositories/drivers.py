"""``drivers`` (Firestore access only). Owner: D3."""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, count, doc_ref, get_doc, query_docs, tx_get


async def get(driver_id: str) -> dict[str, Any] | None:
    return await get_doc(C.drivers, driver_id)


async def tx_get_driver(tx: AsyncTransaction, driver_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.drivers, driver_id)


def tx_update(tx: AsyncTransaction, driver_id: str, data: dict[str, Any]) -> None:
    tx.update(doc_ref(C.drivers, driver_id), data)


def _linked(agency_id: str, status: str | None = None) -> Any:
    q = col(C.drivers).where(filter=FieldFilter("agencyLink.agencyId", "==", agency_id))
    if status:
        q = q.where(filter=FieldFilter("agencyLink.status", "==", status))
    return q


async def list_for_agency(agency_id: str, status: str, limit: int = 200) -> list[dict[str, Any]]:
    q = _linked(agency_id, status).order_by("fullName").order_by("__name__").limit(limit)
    return await query_docs(q)


async def all_for_agency(agency_id: str, limit: int = 500) -> list[dict[str, Any]]:
    return await query_docs(_linked(agency_id).limit(limit))


async def count_for_agency(agency_id: str, status: str) -> int:
    return await count(_linked(agency_id, status))
