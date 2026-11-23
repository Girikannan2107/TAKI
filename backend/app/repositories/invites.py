"""``driverInvites`` (Firestore access only). Owner: D3."""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, doc_ref, query_docs, tx_get, tx_query


async def tx_get_invite(tx: AsyncTransaction, invite_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.driver_invites, invite_id)


async def tx_pending_for_phone(tx: AsyncTransaction, phone: str) -> list[dict[str, Any]]:
    q = (
        col(C.driver_invites)
        .where(filter=FieldFilter("phone", "==", phone))
        .where(filter=FieldFilter("status", "==", "pending"))
        .limit(20)
    )
    return await tx_query(tx, q)


async def list_for_agency(agency_id: str, status: str = "pending", limit: int = 100) -> list[dict[str, Any]]:
    q = (
        col(C.driver_invites)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .where(filter=FieldFilter("status", "==", status))
        .order_by("createdAt", direction="DESCENDING")
        .order_by("__name__", direction="DESCENDING")
        .limit(limit)
    )
    return await query_docs(q)


def tx_create(tx: AsyncTransaction, invite: dict[str, Any]) -> None:
    tx.create(doc_ref(C.driver_invites, invite["id"]), invite)


def tx_update(tx: AsyncTransaction, invite_id: str, data: dict[str, Any]) -> None:
    tx.update(doc_ref(C.driver_invites, invite_id), data)
