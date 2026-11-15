"""Stored responses for ``Idempotency-Key`` replays: ``idempotencyKeys/{sha256(scope:uid:key)}``.

Used by D4/D5 mutating endpoints marked 🔑 (P2 §8.4). 24 h TTL on ``expiresAt``.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.security import sha256_hex
from app.repositories.base import C, doc_ref, get_doc, tx_get

TTL = timedelta(hours=24)


def key_id(scope: str, uid: str, key: str) -> str:
    return sha256_hex(f"{scope}:{uid}:{key}")


async def get(scope: str, uid: str, key: str) -> dict[str, Any] | None:
    return await get_doc(C.idempotency_keys, key_id(scope, uid, key))


async def tx_get_record(tx: AsyncTransaction, scope: str, uid: str, key: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.idempotency_keys, key_id(scope, uid, key))


def tx_put(
    tx: AsyncTransaction,
    *,
    scope: str,
    uid: str,
    key: str,
    request_hash: str,
    status: int,
    body: dict[str, Any],
    now: datetime,
) -> None:
    doc_id = key_id(scope, uid, key)
    tx.set(
        doc_ref(C.idempotency_keys, doc_id),
        {
            "id": doc_id,
            "scope": scope,
            "uid": uid,
            "requestHash": request_hash,
            "status": status,
            "body": body,
            "createdAt": now,
            "expiresAt": now + TTL,
        },
    )
