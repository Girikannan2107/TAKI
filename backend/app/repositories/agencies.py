"""``agencies`` (Firestore access only). Owner: D3."""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, doc_ref, get_doc, query_docs, tx_get


async def get(agency_id: str) -> dict[str, Any] | None:
    return await get_doc(C.agencies, agency_id)


async def tx_get_agency(tx: AsyncTransaction, agency_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.agencies, agency_id)


def tx_update(tx: AsyncTransaction, agency_id: str, data: dict[str, Any]) -> None:
    tx.update(doc_ref(C.agencies, agency_id), data)


async def by_owner(owner_uid: str) -> dict[str, Any] | None:
    rows = await query_docs(col(C.agencies).where(filter=FieldFilter("ownerUid", "==", owner_uid)).limit(1))
    return rows[0] if rows else None
