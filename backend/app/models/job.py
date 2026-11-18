"""``jobs/{job_*}`` outbox (P2 §6.4, §0.13). Owner: D3 (model); the runner is D5's ``jobs_service``."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from app.models.base import DocModel

JobType = Literal["refund", "refund_status", "delete_files"]
JobStatus = Literal["pending", "running", "succeeded", "failed"]


class JobDoc(DocModel):
    type: str
    payload: dict[str, Any] = {}
    status: JobStatus = "pending"
    attempts: int = 0
    next_attempt_at: datetime
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime
