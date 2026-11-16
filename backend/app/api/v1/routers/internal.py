"""E129: ``POST /internal/sweep`` (Cloud Scheduler, every 5 minutes). Owner: D4.

Auth: Google OIDC (``aud = SWEEP_OIDC_AUDIENCE``, email in ``SWEEP_INVOKER_EMAILS``) or
``Bearer CRON_SECRET``; 503 ``cron_not_configured`` when neither is configured. GET is not served.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header

from app.core.clock import Clock, get_clock
from app.core.config import Settings, get_settings
from app.schemas.common import CamelModel
from app.schemas.errors import error_responses
from app.services import sweep_service

router = APIRouter(prefix="/internal", tags=["internal"])


class SweepResult(CamelModel):
    expired_requests: int
    expired_payments: int
    reconciled_payments: int
    jobs_run: int
    jobs_failed: int
    invites_expired: int
    orphan_users_deleted: int
    duration_ms: int


@router.post("/sweep", response_model=SweepResult, responses=error_responses(401, 503))
async def sweep(
    settings: Annotated[Settings, Depends(get_settings)],
    clock: Annotated[Clock, Depends(get_clock)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    await sweep_service.authorize(authorization, settings)
    return await sweep_service.run(clock.now())
