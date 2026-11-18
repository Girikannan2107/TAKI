"""E86 driver dashboard (works unlinked) and E100 delivery history. Owner: D4."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.deps import require_role
from app.schemas.driver import DriverDashboardDTO, DriverHistoryDTO
from app.schemas.errors import error_responses
from app.services import tracking_service

router = APIRouter(prefix="/driver", tags=["driver"])

DriverDep = Annotated[CurrentUser, Depends(require_role("driver"))]


@router.get("/dashboard", response_model=DriverDashboardDTO, responses=error_responses(401, 403))
async def dashboard(user: DriverDep, clock: Annotated[Clock, Depends(get_clock)]) -> dict[str, Any]:
    return await tracking_service.driver_dashboard(user, now=clock.now())


@router.get("/history", response_model=DriverHistoryDTO, responses=error_responses(401, 403))
async def history(
    user: DriverDep,
    q: Annotated[str | None, Query(max_length=20)] = None,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> dict[str, Any]:
    return await tracking_service.driver_history(user, q=q, month=month, limit=limit, cursor=cursor)
