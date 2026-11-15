"""Firestore access base (minimal; created by D2 — **D3 takes ownership** and may extend it).

* ``get_db()``: the async Firestore client (emulator-aware, one per event loop).
* ``C``: collection names (P2 §6.3).
* ``run_transaction(fn)``: runs ``async fn(tx)`` in a Firestore transaction (max 5 attempts);
  contention after retries → 409 ``contention``; Firestore outage → 503 ``database_unavailable``.
* ``doc_to_dict`` / ``tx_get``: snapshot helpers that return plain camelCase dicts.

Firestore stores camelCase fields; repositories return dicts and services read them by key.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Final

from google.api_core import exceptions as gexc
from google.cloud import firestore
from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.errors import AppError
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
    contact_messages: Final = "contactMessages"
    audit_log: Final = "auditLog"


def get_db() -> firestore.AsyncClient:
    return get_firestore()


def doc_ref(collection: str, doc_id: str) -> firestore.AsyncDocumentReference:
    return get_db().collection(collection).document(doc_id)


def doc_to_dict(snap: Any) -> dict[str, Any] | None:
    if snap is None or not snap.exists:
        return None
    data: dict[str, Any] = snap.to_dict() or {}
    data.setdefault("id", snap.id)
    return data


async def get_doc(collection: str, doc_id: str) -> dict[str, Any] | None:
    try:
        return doc_to_dict(await doc_ref(collection, doc_id).get())
    except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
        raise AppError("database_unavailable") from e


async def tx_get(tx: AsyncTransaction, collection: str, doc_id: str) -> dict[str, Any] | None:
    return doc_to_dict(await doc_ref(collection, doc_id).get(transaction=tx))


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
        raise AppError("database_unavailable") from e


async def query_docs(query: Any) -> list[dict[str, Any]]:
    try:
        return [d for d in (doc_to_dict(s) for s in await query.get()) if d is not None]
    except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
        raise AppError("database_unavailable") from e


async def count(query: Any) -> int:
    """Aggregate count (no document reads billed per document)."""
    try:
        result = await query.count().get()
        return int(result[0][0].value)
    except (gexc.ServiceUnavailable, gexc.DeadlineExceeded) as e:
        raise AppError("database_unavailable") from e
