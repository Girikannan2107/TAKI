"""``auditLog/{aud_*}``: admin and security actions (P2 §12.4)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.ids import new_id
from app.repositories.base import C, doc_ref


def _doc(
    actor_uid: str | None, action: str, target_type: str, target_id: str, data: dict[str, Any] | None, now: datetime
) -> dict[str, Any]:
    aid = new_id("aud")
    return {
        "id": aid,
        "actorUid": actor_uid,
        "action": action,
        "target": {"type": target_type, "id": target_id},
        "data": data or {},
        "at": now,
    }


def tx_write(
    tx: AsyncTransaction,
    *,
    actor_uid: str | None,
    action: str,
    target_type: str,
    target_id: str,
    now: datetime,
    data: dict[str, Any] | None = None,
) -> None:
    d = _doc(actor_uid, action, target_type, target_id, data, now)
    tx.set(doc_ref(C.audit_log, d["id"]), d)


async def write(
    *,
    actor_uid: str | None,
    action: str,
    target_type: str,
    target_id: str,
    now: datetime,
    data: dict[str, Any] | None = None,
) -> None:
    d = _doc(actor_uid, action, target_type, target_id, data, now)
    await doc_ref(C.audit_log, d["id"]).set(d)
