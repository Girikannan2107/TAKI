"""``schedules/{driver:uid | vehicle:veh_*}`` busy intervals (Firestore access only, P2 §8.3). Owner: D3.

Publish / reassign / time edits read both schedule docs **inside** the transaction, so concurrent
assignments of the same driver or vehicle serialise; overlap logic is in ``domain/trip_rules``.
"""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.repositories.base import C, doc_ref, get_many, tx_get, tx_get_many
from app.repositories.collections import ScheduleKind, schedule_id


async def tx_get_schedule(tx: AsyncTransaction, kind: ScheduleKind, resource_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.schedules, schedule_id(kind, resource_id))


async def tx_get_schedules(tx: AsyncTransaction, keys: list[tuple[ScheduleKind, str]]) -> list[dict[str, Any] | None]:
    return await tx_get_many(tx, C.schedules, [schedule_id(k, r) for k, r in keys])


async def get_schedules(keys: list[tuple[ScheduleKind, str]]) -> list[dict[str, Any] | None]:
    return await get_many(C.schedules, [schedule_id(k, r) for k, r in keys])


def tx_set(tx: AsyncTransaction, schedule: dict[str, Any]) -> None:
    tx.set(doc_ref(C.schedules, schedule["id"]), schedule)
