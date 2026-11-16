"""E107: reviews of a driver or an agency (customer first name only). Owner: D4."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor
from app.deps import get_current_user
from app.repositories import reviews as reviews_repo
from app.schemas.customer import ReviewPage
from app.schemas.errors import error_responses
from app.views.bookings import review_dto

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.get("", response_model=ReviewPage, responses=error_responses(400, 401))
async def list_reviews(
    _user: Annotated[CurrentUser, Depends(get_current_user)],
    driver_id: Annotated[str | None, Query(alias="driverId", pattern=r"^[A-Za-z0-9]{1,128}$")] = None,
    agency_id: Annotated[str | None, Query(alias="agencyId", pattern=r"^agc_[a-z0-9]{20}$")] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> dict[str, Any]:
    if bool(driver_id) == bool(agency_id):
        raise AppError("invalid_request", "Give exactly one of driverId or agencyId.", fields={"driverId": "Required"})
    field, value = ("driverId", driver_id) if driver_id else ("agencyId", agency_id)
    c = decode_cursor(cursor)
    after = str(c.get("id", "")) if c else None
    rows = await reviews_repo.list_for(field, str(value), limit=limit + 1, after_id=after)
    page = rows[:limit]
    return {
        "items": [review_dto(r) for r in page],
        "nextCursor": encode_cursor({"id": page[-1]["id"]}) if len(rows) > limit and page else None,
    }
