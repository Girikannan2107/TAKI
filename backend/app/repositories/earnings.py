"""``earnings/{bookingId}`` (Firestore access only). Owner: D3. Created by D4's deliver transaction."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, doc_ref, query_docs, tx_get_many

_TIME_FIELDS = ("deliveredAt", "settledAt", "createdAt", "updatedAt")


def as_datetime(v: Any) -> Any:
    """Firestore Timestamp / aware datetime / ISO-8601 string (legacy or hand-written docs) → aware UTC
    datetime, so earnings from different writers sort and compare (T1-4)."""
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return v
        return d if d.tzinfo else d.replace(tzinfo=UTC)
    if isinstance(v, datetime) and v.tzinfo is None:
        return v.replace(tzinfo=UTC)
    return v


def normalize(e: dict[str, Any] | None) -> dict[str, Any] | None:
    if e is None:
        return None
    return {**e, **{k: as_datetime(e[k]) for k in _TIME_FIELDS if e.get(k) is not None}}


def _norm_all(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in (normalize(x) for x in rows) if r is not None]


async def for_agency(agency_id: str, limit: int = 2000) -> list[dict[str, Any]]:
    q = (
        col(C.earnings)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .order_by("deliveredAt", direction="DESCENDING")
        .limit(limit)
    )
    return _norm_all(await query_docs(q))


async def pending_for_agency(agency_id: str, limit: int = 2000) -> list[dict[str, Any]]:
    q = (
        col(C.earnings)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .where(filter=FieldFilter("status", "==", "pending"))
        .order_by("deliveredAt", direction="DESCENDING")
        .limit(limit)
    )
    return _norm_all(await query_docs(q))


async def all_pending(limit: int = 5000) -> list[dict[str, Any]]:
    q = col(C.earnings).where(filter=FieldFilter("status", "==", "pending")).order_by("deliveredAt").limit(limit)
    return _norm_all(await query_docs(q))


async def tx_get_earnings(tx: AsyncTransaction, ids: list[str]) -> list[dict[str, Any] | None]:
    return [normalize(e) for e in await tx_get_many(tx, C.earnings, ids)]


def tx_set(tx: AsyncTransaction, earning: dict[str, Any]) -> None:
    tx.set(doc_ref(C.earnings, earning["id"]), earning)


def tx_update(tx: AsyncTransaction, earning_id: str, data: dict[str, Any]) -> None:
    tx.update(doc_ref(C.earnings, earning_id), data)
