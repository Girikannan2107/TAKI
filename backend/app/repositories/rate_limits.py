"""Fixed-window rate limits in ``rateLimits/{sha256(bucket|window)}`` (P2 §5.8, ported from v2).

The counter is incremented in a transaction; a breach raises 429 ``rate_limited`` with
``details.retryAfterSeconds`` and a ``Retry-After`` header.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

from google.cloud.firestore_v1.async_transaction import AsyncTransaction

from app.core.errors import AppError
from app.core.security import sha256_hex
from app.repositories.base import C, doc_ref, run_transaction, tx_get


async def hit(bucket: str, limit: int, window_seconds: int, now: datetime) -> int:
    """Count one hit on ``bucket``. Returns the remaining allowance; raises when over the limit."""
    key = f"{bucket}|{window_seconds}"
    doc_id = sha256_hex(key)

    async def _tx(tx: AsyncTransaction) -> int:
        cur: dict[str, Any] | None = await tx_get(tx, C.rate_limits, doc_id)
        fresh = cur is None or cur["expiresAt"] <= now
        window_start: datetime = now if fresh else cur["windowStart"]  # type: ignore[index]
        count = 1 if fresh else int(cur["count"]) + 1  # type: ignore[index]
        expires = window_start + timedelta(seconds=window_seconds)
        if count > limit:
            retry = max(1, math.ceil((expires - now).total_seconds()))
            raise AppError(
                "rate_limited",
                details={"retryAfterSeconds": retry},
                headers={"Retry-After": str(retry)},
            )
        tx.set(
            doc_ref(C.rate_limits, doc_id),
            {
                "id": doc_id,
                "bucket": key,
                "count": count,
                "windowStart": window_start,
                "expiresAt": expires,
            },
        )
        return limit - count

    return await run_transaction(_tx, max_attempts=10)
