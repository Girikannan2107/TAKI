"""``jobs/{job_*}`` outbox (Firestore access only). Owner: D3. D5's ``jobs_service`` runs them.

Use ``jobs_service.enqueue(tx, …)`` from business code; this module offers the raw reads used by
ops scripts and invariants (``status ASC, nextAttemptAt ASC`` index).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from google.cloud.firestore_v1.base_query import FieldFilter

from app.repositories.base import C, col, count, query_docs


async def due(now: datetime, limit: int = 50) -> list[dict[str, Any]]:
    q = (
        col(C.jobs)
        .where(filter=FieldFilter("status", "==", "pending"))
        .where(filter=FieldFilter("nextAttemptAt", "<=", now))
        .order_by("nextAttemptAt")
        .limit(limit)
    )
    return await query_docs(q)


async def count_by_status(status: str) -> int:
    return await count(col(C.jobs).where(filter=FieldFilter("status", "==", status)))
