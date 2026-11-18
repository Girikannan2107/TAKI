"""E84: agency history search (role ``agency``). Owner: D3."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.context import CurrentUser
from app.deps import require_role
from app.schemas.agency import HistoryPage, HistoryType
from app.schemas.common import IsoDate
from app.services import agency_service

router = APIRouter(prefix="/agency", tags=["agency"])
AgencyDep = Annotated[CurrentUser, Depends(require_role("agency"))]


@router.get("/history", response_model=HistoryPage)
async def history(
    user: AgencyDep,
    q: Annotated[str | None, Query(max_length=60)] = None,
    type_: Annotated[HistoryType, Query(alias="type")] = "bookings",
    from_: Annotated[IsoDate | None, Query(alias="from")] = None,
    to: Annotated[IsoDate | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> HistoryPage:
    return await agency_service.history(
        user, type_=type_, q=(q or "").strip() or None, frm=from_, to=to, limit=limit, cursor=cursor
    )
