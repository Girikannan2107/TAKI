"""``earnings/{bookingId}`` (Firestore access only). Owner: D3. Created by D4's deliver transaction."""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, doc_ref, query_docs, tx_get_many


async def for_agency(agency_id: str, limit: int = 2000) -> list[dict[str, Any]]:
    q = (
        col(C.earnings)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .order_by("deliveredAt", direction="DESCENDING")
        .limit(limit)
    )
    return await query_docs(q)


async def pending_for_agency(agency_id: str, limit: int = 2000) -> list[dict[str, Any]]:
    q = (
        col(C.earnings)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .where(filter=FieldFilter("status", "==", "pending"))
        .order_by("deliveredAt", direction="DESCENDING")
        .limit(limit)
    )
    return await query_docs(q)


async def all_pending(limit: int = 5000) -> list[dict[str, Any]]:
    q = col(C.earnings).where(filter=FieldFilter("status", "==", "pending")).order_by("deliveredAt").limit(limit)
    return await query_docs(q)


async def tx_get_earnings(tx: AsyncTransaction, ids: list[str]) -> list[dict[str, Any] | None]:
    return await tx_get_many(tx, C.earnings, ids)


def tx_set(tx: AsyncTransaction, earning: dict[str, Any]) -> None:
    tx.set(doc_ref(C.earnings, earning["id"]), earning)


def tx_update(tx: AsyncTransaction, earning_id: str, data: dict[str, Any]) -> None:
    tx.update(doc_ref(C.earnings, earning_id), data)
