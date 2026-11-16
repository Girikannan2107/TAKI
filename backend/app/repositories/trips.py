"""``trips`` + ``trips/{id}/events`` (Firestore access only). Owner: D3."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.ids import new_id
from app.repositories.base import (
    C,
    col,
    count,
    doc_ref,
    get_doc,
    page_query,
    query_docs,
    sub_ref,
    tx_get,
    tx_query,
)

LIVE = ["published", "in_progress"]


async def get(trip_id: str) -> dict[str, Any] | None:
    return await get_doc(C.trips, trip_id)


async def tx_get_trip(tx: AsyncTransaction, trip_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.trips, trip_id)


def tx_create(tx: AsyncTransaction, trip: dict[str, Any]) -> None:
    tx.create(doc_ref(C.trips, trip["id"]), trip)


def tx_set(tx: AsyncTransaction, trip: dict[str, Any]) -> None:
    tx.set(doc_ref(C.trips, trip["id"]), trip)


def tx_update(tx: AsyncTransaction, trip_id: str, data: dict[str, Any]) -> None:
    tx.update(doc_ref(C.trips, trip_id), data)


def tx_delete(tx: AsyncTransaction, trip_id: str) -> None:
    tx.delete(doc_ref(C.trips, trip_id))


def tx_add_event(tx: AsyncTransaction, trip_id: str, event: dict[str, Any]) -> str:
    eid = event.get("id") or new_id("tev")
    tx.create(sub_ref(C.trips, trip_id, C.trip_events, eid), {**event, "id": eid, "tripId": trip_id})
    return eid


async def events(trip_id: str, limit: int = 100) -> list[dict[str, Any]]:
    q = col(C.trips).document(trip_id).collection(C.trip_events).order_by("at").limit(limit)
    return await query_docs(q)


def _agency_tab(agency_id: str, statuses: Sequence[str]) -> Any:
    q = col(C.trips).where(filter=FieldFilter("agencyId", "==", agency_id))
    if len(statuses) == 1:
        return q.where(filter=FieldFilter("status", "==", statuses[0]))
    return q.where(filter=FieldFilter("status", "in", list(statuses)))


async def page_for_agency(
    agency_id: str, statuses: Sequence[str], ascending: bool, limit: int, cursor: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    d = "ASCENDING" if ascending else "DESCENDING"
    q = _agency_tab(agency_id, statuses).order_by("departureAt", direction=d).order_by("__name__", direction=d)
    return await page_query(C.trips, q, limit, cursor)


async def count_for_agency(agency_id: str, statuses: Sequence[str]) -> int:
    return await count(_agency_tab(agency_id, statuses))


async def list_for_agency(
    agency_id: str, statuses: Sequence[str] | None = None, *, ascending: bool = False, limit: int = 500
) -> list[dict[str, Any]]:
    d = "ASCENDING" if ascending else "DESCENDING"
    q = (
        _agency_tab(agency_id, statuses)
        if statuses
        else col(C.trips).where(filter=FieldFilter("agencyId", "==", agency_id))
    )
    return await query_docs(q.order_by("departureAt", direction=d).order_by("__name__", direction=d).limit(limit))


def _live_for(field: str, value: str) -> Any:
    return col(C.trips).where(filter=FieldFilter(field, "==", value)).where(filter=FieldFilter("status", "in", LIVE))


async def count_live_for_vehicle(vehicle_id: str) -> int:
    return await count(_live_for("vehicleId", vehicle_id))


async def tx_live_for_vehicle(tx: AsyncTransaction, vehicle_id: str, limit: int = 5) -> list[dict[str, Any]]:
    return await tx_query(tx, _live_for("vehicleId", vehicle_id).limit(limit))


async def tx_live_for_driver(tx: AsyncTransaction, driver_id: str, limit: int = 10) -> list[dict[str, Any]]:
    return await tx_query(tx, _live_for("driverId", driver_id).limit(limit))


async def live_for_driver(driver_id: str, limit: int = 10) -> list[dict[str, Any]]:
    return await query_docs(_live_for("driverId", driver_id).limit(limit))


async def open_for_driver(driver_id: str, limit: int = 100) -> list[dict[str, Any]]:
    q = (
        col(C.trips)
        .where(filter=FieldFilter("driverId", "==", driver_id))
        .where(filter=FieldFilter("status", "in", ["draft", "published"]))
        .limit(limit)
    )
    return await query_docs(q)


async def for_driver(driver_id: str, limit: int = 50) -> list[dict[str, Any]]:
    q = (
        col(C.trips)
        .where(filter=FieldFilter("driverId", "==", driver_id))
        .order_by("departureAt", direction="DESCENDING")
        .limit(limit)
    )
    return await query_docs(q)


async def open_for_agency(agency_id: str, limit: int = 1000) -> list[dict[str, Any]]:
    """Non-terminal trips (draft / published / in_progress) — denormalisation fan-out."""
    q = _agency_tab(agency_id, ["draft", "published", "in_progress"]).limit(limit)
    return await query_docs(q)


async def open_for_vehicle(vehicle_id: str, limit: int = 200) -> list[dict[str, Any]]:
    q = (
        col(C.trips)
        .where(filter=FieldFilter("vehicleId", "==", vehicle_id))
        .where(filter=FieldFilter("status", "in", ["draft", "published"]))
        .limit(limit)
    )
    return await query_docs(q)
