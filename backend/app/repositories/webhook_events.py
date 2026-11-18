"""``webhookEvents/{sha256(eventKey)}``: verified-webhook dedupe and audit. Owner: D5.

The document is created inside the same transaction that applies the event, so a crash before
commit leaves no dedupe record and Cashfree's retry is processed normally.
"""

from __future__ import annotations

import hashlib

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.models.payment import WebhookEventDoc
from app.repositories.base import C, doc_ref, get_doc, tx_get


def event_id(event_key: str) -> str:
    return hashlib.sha256(event_key.encode("utf-8")).hexdigest()


async def get(event_key: str) -> WebhookEventDoc | None:
    return WebhookEventDoc.from_firestore(await get_doc(C.webhook_events, event_id(event_key)))


async def tx_exists(tx: AsyncTransaction, event_key: str) -> bool:
    return await tx_get(tx, C.webhook_events, event_id(event_key)) is not None


def tx_create(tx: AsyncTransaction, event: WebhookEventDoc) -> None:
    tx.create(doc_ref(C.webhook_events, event.id), event.to_firestore())


async def put(event: WebhookEventDoc) -> None:
    """Outside a transaction (ignored / unknown events)."""
    await doc_ref(C.webhook_events, event.id).set(event.to_firestore())
