"""Accounts: ``users``, ``credentials``, ``phoneIndex`` and ``customers`` (Firestore access only)."""

from __future__ import annotations

from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.repositories.base import C, doc_ref, get_doc, tx_get


async def get_user(uid: str) -> dict[str, Any] | None:
    return await get_doc(C.users, uid)


async def tx_get_user(tx: AsyncTransaction, uid: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.users, uid)


async def get_credentials(uid: str) -> dict[str, Any] | None:
    return await get_doc(C.credentials, uid)


async def tx_get_credentials(tx: AsyncTransaction, uid: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.credentials, uid)


async def get_phone_index(e164: str) -> dict[str, Any] | None:
    return await get_doc(C.phone_index, e164)


async def tx_get_phone_index(tx: AsyncTransaction, e164: str) -> dict[str, Any] | None:
    return await tx_get(tx, C.phone_index, e164)


async def get_customer(uid: str) -> dict[str, Any] | None:
    return await get_doc(C.customers, uid)


def tx_set(tx: AsyncTransaction, collection: str, doc_id: str, data: dict[str, Any]) -> None:
    tx.set(doc_ref(collection, doc_id), data)


def tx_update(tx: AsyncTransaction, collection: str, doc_id: str, data: dict[str, Any]) -> None:
    tx.update(doc_ref(collection, doc_id), data)


def tx_delete(tx: AsyncTransaction, collection: str, doc_id: str) -> None:
    tx.delete(doc_ref(collection, doc_id))


async def update_user(uid: str, data: dict[str, Any]) -> None:
    await doc_ref(C.users, uid).update(data)


async def update_credentials(uid: str, data: dict[str, Any]) -> None:
    await doc_ref(C.credentials, uid).update(data)
