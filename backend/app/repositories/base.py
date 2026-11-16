"""Firestore access base. Owner: D3 (created by D2; public API kept).

* ``get_db()``: the async Firestore client (emulator-aware, one per event loop). ``use_database(name)``
  switches every caller to a **named** database (test isolation: suites that wipe ``(default)`` and
  suites on ``d3-data`` / ``d5-payments`` can share one emulator).
* ``C``: collection names (P2 §6.3); subcollection and schedule helpers live in ``collections.py``.
* ``run_transaction(fn)``: runs ``async fn(tx)`` in a Firestore transaction (max 5 attempts);
  contention after retries → 409 ``contention``; Firestore outage → 503 ``database_unavailable``.
* ``doc_to_dict`` / ``get_doc`` / ``get_many`` / ``tx_get`` / ``tx_get_many`` / ``tx_query``:
  snapshot helpers returning plain camelCase dicts (``id`` always set).
* ``query_docs`` / ``count`` / ``page_query``: queries, aggregate counts and cursor pages.

Firestore stores camelCase fields; repositories return dicts and services read them by key.
Every Firestore call goes through ``get_db()`` here, so ``use_database`` covers all repositories.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, Final

from google.api_core import exceptions as gexc
from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor
from app.integrations.firebase.app import get_firestore


class C:
    """Collection names (P2 §6.3)."""

    users: Final = "users"
    credentials: Final = "credentials"
    phone_index: Final = "phoneIndex"
    customers: Final = "customers"
    agencies: Final = "agencies"
    drivers: Final = "drivers"
    driver_invites: Final = "driverInvites"
    vehicles: Final = "vehicles"
    registration_index: Final = "registrationIndex"
    schedules: Final = "schedules"
    trips: Final = "trips"
    trip_events: Final = "events"  # subcollection of trips/{id}
    shipments: Final = "shipments"
    bookings: Final = "bookings"
    booking_secrets: Final = "bookingSecrets"
    payments: Final = "payments"
    webhook_events: Final = "webhookEvents"
    idempotency_keys: Final = "idempotencyKeys"
    reviews: Final = "reviews"
    earnings: Final = "earnings"
    settlements: Final = "settlements"
    notifications: Final = "notifications"
    files: Final = "files"
    jobs: Final = "jobs"
    rate_limits: Final = "rateLimits"
    geocode_cache: Final = "geocodeCache"
    distance_cache: Final = "distanceCache"
    route_cache: Final = "routeCache"
    contact_messages: Final = "contactMessages"
    audit_log: Final = "auditLog"


# ── Client ────────────────────────────────────────────────────────────────────
_database: str | None = None
_named_clients: dict[tuple[str, int], firestore.AsyncClient] = {}


def use_database(name: str | None) -> None:
    """Route every ``get_db()`` call to the named database (``None`` → ``(default)``). Tests only."""
    global _database
    _database = None if name in (None, "", "(default)") else name


def current_database() -> str:
    return _database or "(default)"


def _named_client(name: str) -> firestore.AsyncClient:
    loop_id = id(asyncio.get_running_loop())
    client = _named_clients.get((name, loop_id))
    if client is None:
        from google.auth.credentials import AnonymousCredentials

        from app.core.config import get_settings

        project = get_settings().FIREBASE_PROJECT_ID or os.environ.get("FIREBASE_PROJECT_ID", "demo-taki")
        if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise RuntimeError("Named test databases are only supported against the Firestore emulator.")
        client = firestore.AsyncClient(project=project, database=name, credentials=AnonymousCredentials())
        _named_clients[(name, loop_id)] = client
    return client


def get_db() -> firestore.AsyncClient:
    if _database is not None:
        return _named_client(_database)
    return get_firestore()


def col(collection: str) -> firestore.AsyncCollectionReference:
    return get_db().collection(collection)


def doc_ref(collection: str, doc_id: str) -> firestore.AsyncDocumentReference:
    return get_db().collection(collection).document(doc_id)


def sub_ref(collection: str, doc_id: str, sub: str, sub_id: str) -> firestore.AsyncDocumentReference:
    return get_db().collection(collection).document(doc_id).collection(sub).document(sub_id)


# ── Reads ─────────────────────────────────────────────────────────────────────
def doc_to_dict(snap: Any) -> dict[str, Any] | None:
    if snap is None or not snap.exists:
        return None
    data: dict[str, Any] = snap.to_dict() or {}
    data.setdefault("id", snap.id)
    return data


def _db_error(_e: Exception) -> AppError:
    return AppError("database_unavailable")


async def get_doc(collection: str, doc_id: str) -> dict[str, Any] | None:
    try:
        return doc_to_dict(await doc_ref(collection, doc_id).get())
    except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
        raise _db_error(e) from e


async def get_many(collection: str, ids: Sequence[str]) -> list[dict[str, Any] | None]:
    """Documents in ``ids`` order (``None`` for missing ones)."""
    if not ids:
        return []
    refs = [doc_ref(collection, i) for i in ids]
    try:
        by_id = {s.id: doc_to_dict(s) async for s in get_db().get_all(refs)}
    except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
        raise _db_error(e) from e
    return [by_id.get(i) for i in ids]


async def tx_get(tx: AsyncTransaction, collection: str, doc_id: str) -> dict[str, Any] | None:
    return doc_to_dict(await doc_ref(collection, doc_id).get(transaction=tx))


async def tx_get_many(tx: AsyncTransaction, collection: str, ids: Sequence[str]) -> list[dict[str, Any] | None]:
    """Transactional multi-get (one round trip; every document is locked)."""
    if not ids:
        return []
    refs = [doc_ref(collection, i) for i in ids]
    by_id = {s.id: doc_to_dict(s) async for s in get_db().get_all(refs, transaction=tx)}
    return [by_id.get(i) for i in ids]


async def tx_query(tx: AsyncTransaction, query: Any) -> list[dict[str, Any]]:
    """Run a query inside a transaction (its result documents are read-locked)."""
    return [d for d in (doc_to_dict(s) for s in await query.get(transaction=tx)) if d is not None]


async def query_docs(query: Any) -> list[dict[str, Any]]:
    try:
        return [d for d in (doc_to_dict(s) for s in await query.get()) if d is not None]
    except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
        raise _db_error(e) from e


async def count(query: Any) -> int:
    """Aggregate count (no document reads billed per document)."""
    try:
        result = await query.count().get()
        return int(result[0][0].value)
    except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
        raise _db_error(e) from e


async def page_query(
    collection: str, query: Any, limit: int, cursor: str | None
) -> tuple[list[dict[str, Any]], str | None]:
    """Cursor page over an ordered query. The cursor holds the last document id; the query must end
    with an ``__name__`` order so ``start_after(snapshot)`` is stable."""
    cur = decode_cursor(cursor)
    if cur:
        snap = await doc_ref(collection, str(cur.get("id", ""))).get()
        if not snap.exists:
            raise AppError("invalid_request", "Invalid cursor.", fields={"cursor": "Invalid cursor"})
        query = query.start_after(snap)
    docs = await query_docs(query.limit(limit + 1))
    nxt = encode_cursor({"id": docs[limit - 1]["id"]}) if len(docs) > limit else None
    return docs[:limit], nxt


def page_list[T](rows: Sequence[T], limit: int, cursor: str | None) -> tuple[list[T], str | None]:
    """In-memory offset page for small, already-scoped lists (cursor = ``{"o": offset}``)."""
    cur = decode_cursor(cursor) or {}
    try:
        offset = int(cur.get("o", 0))
    except (TypeError, ValueError) as e:
        raise AppError("invalid_request", "Invalid cursor.", fields={"cursor": "Invalid cursor"}) from e
    if offset < 0:
        raise AppError("invalid_request", "Invalid cursor.", fields={"cursor": "Invalid cursor"})
    items = list(rows[offset : offset + limit])
    nxt = encode_cursor({"o": offset + limit}) if offset + limit < len(rows) else None
    return items, nxt


# ── Transactions ──────────────────────────────────────────────────────────────
async def run_transaction[T](fn: Callable[[AsyncTransaction], Awaitable[T]], *, max_attempts: int = 5) -> T:
    """Run ``fn(tx)`` in a transaction. Raise ``AppError`` inside ``fn`` to abort."""
    db = get_db()
    tx = db.transaction(max_attempts=max_attempts)

    @firestore.async_transactional
    async def _run(transaction: AsyncTransaction) -> T:
        return await fn(transaction)

    try:
        return await _run(tx)
    except AppError:
        raise
    except gexc.Aborted as e:
        raise AppError("contention") from e
    except ValueError as e:
        if "attempts" in str(e).lower():  # "Failed to commit transaction in N attempts."
            raise AppError("contention") from e
        raise
    except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
        raise _db_error(e) from e


async def commit_in_batches(writes: Sequence[tuple[str, str, dict[str, Any]]], size: int = 400) -> int:
    """Non-transactional ``update`` fan-out (denormalised refreshes, P2 §6.5) in batches of ``size``."""
    n = 0
    for i in range(0, len(writes), size):
        batch = get_db().batch()
        for collection, doc_id, data in writes[i : i + size]:
            batch.update(doc_ref(collection, doc_id), data)
        try:
            await batch.commit()
        except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
            raise _db_error(e) from e
        n += len(writes[i : i + size])
    return n
