"""``notifications/{ntf_*}`` access. Owner: D4.

Indexes: ``userId ASC, createdAt DESC`` · ``userId ASC, readAt ASC`` · ``userId ASC, readAt ASC, createdAt DESC``.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, count, doc_ref, doc_to_dict, get_db, query_docs


def tx_create(tx: AsyncTransaction, doc: dict[str, Any]) -> None:
    tx.create(doc_ref(C.notifications, doc["id"]), doc)


async def list_for_user(
    user_id: str, *, limit: int, unread_only: bool = False, after_id: str | None = None
) -> list[dict[str, Any]]:
    q: Any = get_db().collection(C.notifications).where(filter=FieldFilter("userId", "==", user_id))
    if unread_only:
        q = q.where(filter=FieldFilter("readAt", "==", None))
    q = q.order_by("createdAt", direction=firestore.Query.DESCENDING).order_by(
        "__name__", direction=firestore.Query.DESCENDING
    )
    if after_id:
        snap = await doc_ref(C.notifications, after_id).get()
        if snap.exists and (snap.to_dict() or {}).get("userId") == user_id:
            q = q.start_after(snap)
    return await query_docs(q.limit(limit))


async def unread_count(user_id: str) -> int:
    q = (
        get_db()
        .collection(C.notifications)
        .where(filter=FieldFilter("userId", "==", user_id))
        .where(filter=FieldFilter("readAt", "==", None))
    )
    return await count(q)


async def mark_read_ids(user_id: str, ids: Sequence[str], now: datetime) -> int:
    refs = [doc_ref(C.notifications, i) for i in dict.fromkeys(ids)]
    if not refs:
        return 0
    db = get_db()
    batch = db.batch()
    n = 0
    async for snap in db.get_all(refs):
        d = doc_to_dict(snap)
        if d is None or d.get("userId") != user_id or d.get("readAt") is not None:
            continue
        batch.update(snap.reference, {"readAt": now})
        n += 1
    if n:
        await batch.commit()
    return n


async def mark_all_read(user_id: str, now: datetime) -> int:
    total = 0
    db = get_db()
    while True:
        q = (
            db.collection(C.notifications)
            .where(filter=FieldFilter("userId", "==", user_id))
            .where(filter=FieldFilter("readAt", "==", None))
            .limit(400)
        )
        snaps = [s async for s in q.stream()]
        if not snaps:
            return total
        batch = db.batch()
        for s in snaps:
            batch.update(s.reference, {"readAt": now})
        await batch.commit()
        total += len(snaps)
        if len(snaps) < 400:
            return total
