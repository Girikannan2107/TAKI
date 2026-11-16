"""E85: agency earnings (role ``agency``; read-only, real earnings/payments/settlements). Owner: D3."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.context import CurrentUser
from app.deps import ClockDep, require_role
from app.schemas.agency import AgencyEarningsDTO
from app.schemas.common import IsoDate
from app.services import earnings_service

router = APIRouter(prefix="/agency", tags=["agency"])
AgencyDep = Annotated[CurrentUser, Depends(require_role("agency"))]


@router.get("/earnings", response_model=AgencyEarningsDTO)
async def earnings(
    user: AgencyDep,
    clock: ClockDep,
    from_: Annotated[IsoDate | None, Query(alias="from")] = None,
    to: Annotated[IsoDate | None, Query()] = None,
) -> AgencyEarningsDTO:
    return await earnings_service.agency_earnings(user, from_, to, clock.now())
