"""``vehicles`` + ``registrationIndex`` (Firestore access only). Owner: D3."""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, count, doc_ref, get_doc, query_docs, tx_get


async def get(vehicle_id: str) -> dict[str, Any] | None:
    return await get_doc(C.vehicles, vehicle_id)


async def tx_get_vehicle(tx: AsyncTransaction, vehicle_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.vehicles, vehicle_id)


async def tx_get_registration(tx: AsyncTransaction, key: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.registration_index, key)


def tx_create(tx: AsyncTransaction, vehicle: dict[str, Any]) -> None:
    tx.create(doc_ref(C.vehicles, vehicle["id"]), vehicle)


def tx_set(tx: AsyncTransaction, vehicle: dict[str, Any]) -> None:
    tx.set(doc_ref(C.vehicles, vehicle["id"]), vehicle)


def tx_update(tx: AsyncTransaction, vehicle_id: str, data: dict[str, Any]) -> None:
    tx.update(doc_ref(C.vehicles, vehicle_id), data)


def tx_claim_registration(tx: AsyncTransaction, key: str, vehicle_id: str, agency_id: str, now: Any) -> None:
    tx.create(
        doc_ref(C.registration_index, key),
        {"id": key, "vehicleId": vehicle_id, "agencyId": agency_id, "createdAt": now},
    )


def tx_release_registration(tx: AsyncTransaction, key: str) -> None:
    tx.delete(doc_ref(C.registration_index, key))


def _for_agency(agency_id: str, statuses: list[str]) -> Any:
    q = col(C.vehicles).where(filter=FieldFilter("agencyId", "==", agency_id))
    if len(statuses) == 1:
        return q.where(filter=FieldFilter("status", "==", statuses[0]))
    return q.where(filter=FieldFilter("status", "in", statuses))


async def list_for_agency(agency_id: str, statuses: list[str], limit: int = 200) -> list[dict[str, Any]]:
    q = (
        _for_agency(agency_id, statuses)
        .order_by("createdAt", direction="DESCENDING")
        .order_by("__name__", direction="DESCENDING")
        .limit(limit)
    )
    return await query_docs(q)


async def all_for_agency(agency_id: str, limit: int = 500) -> list[dict[str, Any]]:
    q = (
        col(C.vehicles)
        .where(filter=FieldFilter("agencyId", "==", agency_id))
        .order_by("createdAt", direction="DESCENDING")
        .order_by("__name__", direction="DESCENDING")
        .limit(limit)
    )
    return await query_docs(q)


async def count_for_agency(agency_id: str, statuses: list[str]) -> int:
    return await count(_for_agency(agency_id, statuses))
