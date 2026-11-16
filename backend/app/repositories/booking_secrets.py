"""``bookingSecrets/{bookingId}``: encrypted pickup/delivery OTPs and attempt counters. Owner: D4.

Never projected directly; only ``views/customer.py`` shows decrypted codes to the booking's customer.
"""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.repositories.base import C, doc_ref, get_doc, tx_get


async def get(booking_id: str) -> dict[str, Any] | None:
    return await get_doc(C.booking_secrets, booking_id)


async def tx_get_secrets(tx: AsyncTransaction, booking_id: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.booking_secrets, booking_id)


def tx_set(tx: AsyncTransaction, doc: dict[str, Any]) -> None:
    tx.set(doc_ref(C.booking_secrets, doc["id"]), doc)


def tx_update(tx: AsyncTransaction, booking_id: str, patch: dict[str, Any]) -> None:
    tx.update(doc_ref(C.booking_secrets, booking_id), patch)
