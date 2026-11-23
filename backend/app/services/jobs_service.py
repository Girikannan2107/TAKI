"""Outbox jobs (P2 §0.13, §13.3): refunds queued inside business transactions, run after commit
(``BackgroundTasks``) and retried by the sweep. Owner: D5.

``jobs/{job_*}``::

    {id, type: "refund"|"refund_status"|"delete_files", payload, status: pending|running|succeeded|failed,
     attempts, nextAttemptAt, lastError, createdAt, updatedAt}

- A claim leases the job (``running``, ``nextAttemptAt = now + 10 min``) so a crashed runner's job is
  picked up again by a later sweep.
- Backoff after a failed attempt: 1, 5, 15, 60, 60, 60, 60, 60 minutes; after 8 attempts the job is
  ``failed`` and a refund becomes ``refund_failed`` (admin queue, ``retry_refund``).
- ``delete_files`` jobs belong to D2's file service and are dispatched through ``register_handler``.

Index needed (D3): ``jobs``: ``status ASC, nextAttemptAt ASC``.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from google.cloud.firestore_v1.async_transaction import AsyncTransaction
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.errors import AppError
from app.core.ids import new_id
from app.repositories.base import C, doc_ref, get_db, query_docs, run_transaction, tx_get

log = logging.getLogger("taki.jobs")

BACKOFF_MINUTES = (1, 5, 15, 60, 60, 60, 60, 60)
MAX_ATTEMPTS = len(BACKOFF_MINUTES)
LEASE = timedelta(minutes=10)
JobType = Literal["refund", "refund_status", "delete_files"]


@dataclass(frozen=True, slots=True)
class JobOutcome:
    kind: Literal["done", "wait", "error"]
    note: str | None = None


Handler = Callable[[dict[str, Any], datetime, int], Awaitable[JobOutcome]]
FinalFailureHook = Callable[[dict[str, Any], datetime], Awaitable[None]]

_handlers: dict[str, Handler] = {}
_final_failure: dict[str, FinalFailureHook] = {}


def register_handler(job_type: str, handler: Handler, on_final_failure: FinalFailureHook | None = None) -> None:
    _handlers[job_type] = handler
    if on_final_failure is not None:
        _final_failure[job_type] = on_final_failure


def backoff_minutes(attempts: int) -> int:
    return BACKOFF_MINUTES[min(max(attempts, 1), len(BACKOFF_MINUTES)) - 1]


def tx_enqueue(tx: AsyncTransaction, job_type: JobType, payload: dict[str, Any], now: datetime) -> str:
    """Write a pending job inside the caller's transaction (writes only). Returns the job id."""
    job_id = new_id("job")
    tx.create(
        doc_ref(C.jobs, job_id),
        {
            "id": job_id,
            "type": job_type,
            "payload": payload,
            "status": "pending",
            "attempts": 0,
            "nextAttemptAt": now,
            "lastError": None,
            "createdAt": now,
            "updatedAt": now,
        },
    )
    return job_id


async def _claim(job_id: str, now: datetime) -> dict[str, Any] | None:
    async def fn(tx: AsyncTransaction) -> dict[str, Any] | None:
        job = await tx_get(tx, C.jobs, job_id)
        if job is None or job.get("status") not in ("pending", "running"):
            return None
        if job["nextAttemptAt"] > now:
            return None
        claimed = {
            **job,
            "status": "running",
            "attempts": int(job.get("attempts", 0)) + 1,
            "nextAttemptAt": now + LEASE,
            "updatedAt": now,
        }
        tx.set(doc_ref(C.jobs, job_id), claimed)
        return claimed

    return await run_transaction(fn)


async def run_job(job_id: str, now: datetime) -> str:
    """Claim and run one job. Returns the resulting status, or ``skipped``."""
    job = await _claim(job_id, now)
    if job is None:
        return "skipped"
    if job["type"] in ("refund", "refund_status") and job["type"] not in _handlers:
        from app.services.payment_service import get_payment_service

        get_payment_service()  # registers the refund handlers
    handler = _handlers.get(job["type"])
    try:
        if handler is None:
            outcome = JobOutcome("error", f"no handler for {job['type']}")
        else:
            outcome = await handler(dict(job.get("payload") or {}), now, int(job["attempts"]))
    except AppError as exc:
        outcome = JobOutcome("error", exc.code)
    except Exception as exc:  # noqa: BLE001 - recorded on the job; the sweep retries
        log.exception("job %s (%s) crashed", job_id, job["type"])
        outcome = JobOutcome("error", type(exc).__name__)

    attempts = int(job["attempts"])
    patch: dict[str, Any]
    if outcome.kind == "done":
        patch = {"status": "succeeded", "lastError": None}
    elif outcome.kind == "wait":
        patch = {
            "status": "pending",
            "nextAttemptAt": now + timedelta(minutes=backoff_minutes(min(attempts, 4))),
            "lastError": outcome.note,
            "attempts": min(attempts, MAX_ATTEMPTS - 1),  # waiting on the provider is not a failure
        }
    elif attempts >= MAX_ATTEMPTS:
        patch = {"status": "failed", "lastError": outcome.note}
        log.error("OPS ALERT: job %s (%s) failed after %s attempts: %s", job_id, job["type"], attempts, outcome.note)
        hook = _final_failure.get(job["type"])
        if hook is not None:
            await hook(dict(job.get("payload") or {}), now)
    else:
        patch = {
            "status": "pending",
            "nextAttemptAt": now + timedelta(minutes=backoff_minutes(attempts)),
            "lastError": outcome.note,
        }
    await doc_ref(C.jobs, job_id).update({**patch, "updatedAt": now})
    return str(patch["status"])


async def run_jobs(job_ids: Iterable[str], now: datetime) -> dict[str, str]:
    """After-commit runner (``BackgroundTasks.add_task(run_jobs, ids, now)``)."""
    return {jid: await run_job(jid, now) for jid in job_ids}


async def run_due_jobs(now: datetime, limit: int = 20) -> tuple[int, int]:
    """Sweep step 4: run due jobs. Returns ``(ran, failed)``."""
    q = (
        get_db()
        .collection(C.jobs)
        .where(filter=FieldFilter("status", "in", ["pending", "running"]))
        .where(filter=FieldFilter("nextAttemptAt", "<=", now))
        .order_by("nextAttemptAt")
        .limit(limit)
    )
    ran = failed = 0
    for job in await query_docs(q):
        status = await run_job(str(job["id"]), now)
        if status != "skipped":
            ran += 1
        if status == "failed":
            failed += 1
    return ran, failed


async def get_job(job_id: str) -> dict[str, Any] | None:
    snap = await doc_ref(C.jobs, job_id).get()
    return snap.to_dict() if snap.exists else None
