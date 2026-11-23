"""E25: customer dashboard aggregates. Owner: D4."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.deps import require_role
from app.schemas.customer import CustomerDashboardDTO
from app.schemas.errors import error_responses
from app.services import tracking_service

router = APIRouter(prefix="/customer", tags=["customer"])


@router.get("/dashboard", response_model=CustomerDashboardDTO, responses=error_responses(401, 403))
async def dashboard(
    user: Annotated[CurrentUser, Depends(require_role("customer"))], clock: Annotated[Clock, Depends(get_clock)]
) -> dict[str, Any]:
    return await tracking_service.customer_dashboard(user, now=clock.now())
