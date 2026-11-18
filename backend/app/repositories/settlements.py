"""``settlements/{stl_*}`` (Firestore access only). Owner: D3."""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, doc_ref, page_query, query_docs, tx_query


async def for_agency(agency_id: str, limit: int = 50) -> list[dict[str, Any]]:
    q = (
        col(C.settlements)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .order_by("settledAt", direction="DESCENDING")
        .limit(limit)
    )
    return await query_docs(q)


def _reference_query(agency_id: str, reference: str):  # noqa: ANN202 - firestore query
    return (
        col(C.settlements)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .where(filter=FieldFilter("reference", "==", reference))
        .limit(1)
    )


async def by_reference(agency_id: str, reference: str) -> list[dict[str, Any]]:
    return await query_docs(_reference_query(agency_id, reference))


async def tx_by_reference(tx: AsyncTransaction, agency_id: str, reference: str) -> list[dict[str, Any]]:
    return await tx_query(tx, _reference_query(agency_id, reference))


async def page(agency_id: str | None, limit: int, cursor: str | None) -> tuple[list[dict[str, Any]], str | None]:
    q: Any = col(C.settlements)
    if agency_id:
        q = q.where(filter=FieldFilter("agencyId", "==", agency_id))
    q = q.order_by("settledAt", direction="DESCENDING").order_by("__name__", direction="DESCENDING")
    return await page_query(C.settlements, q, limit, cursor)


def tx_create(tx: AsyncTransaction, settlement: dict[str, Any]) -> None:
    tx.create(doc_ref(C.settlements, settlement["id"]), settlement)
