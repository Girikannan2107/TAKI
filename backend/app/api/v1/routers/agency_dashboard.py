"""E47: agency dashboard (role ``agency``). Owner: D3."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.context import CurrentUser
from app.deps import ClockDep, require_role
from app.schemas.agency import AgencyDashboardDTO
from app.services import agency_service

router = APIRouter(prefix="/agency", tags=["agency"])
AgencyDep = Annotated[CurrentUser, Depends(require_role("agency"))]


@router.get("/dashboard", response_model=AgencyDashboardDTO)
async def dashboard(user: AgencyDep, clock: ClockDep) -> AgencyDashboardDTO:
    return await agency_service.dashboard(user, clock.now())
