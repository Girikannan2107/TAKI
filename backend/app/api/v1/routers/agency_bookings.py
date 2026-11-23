"""E80–E83: agency bookings (list with tab counts, detail, accept, reject). Owner: D4.

Accept holds capacity on the customer's legs inside one transaction (D3 ``domain/capacity``);
two concurrent accepts on the last space serialise and exactly one wins.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Path, Query

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.deps import require_role
from app.schemas.customer import AgencyBookingDTO, AgencyBookingListResponse, RejectBookingBody
from app.schemas.errors import error_responses
from app.services import booking_service, jobs_service, tracking_service

router = APIRouter(prefix="/agency/bookings", tags=["agency"])

AgencyDep = Annotated[CurrentUser, Depends(require_role("agency"))]
ClockDep = Annotated[Clock, Depends(get_clock)]
BookingIdPath = Annotated[str, Path(pattern=r"^TAKI\d{8}$")]
Tab = Literal["pending", "accepted", "confirmed", "rejected", "cancelled"]


def _after(background: BackgroundTasks, jobs: list[str], clock: Clock) -> None:
    if jobs:
        background.add_task(jobs_service.run_jobs, list(jobs), clock.now())


@router.get("", response_model=AgencyBookingListResponse, responses=error_responses(401, 403))
async def list_bookings(
    user: AgencyDep,
    clock: ClockDep,
    tab: Tab = "pending",
    trip_id: Annotated[str | None, Query(alias="tripId", pattern=r"^trp_[a-z0-9]{20}$")] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> dict[str, Any]:
    return await tracking_service.agency_bookings(
        user, tab=tab, trip_id=trip_id, limit=limit, cursor=cursor, now=clock.now()
    )


@router.get("/{booking_id}", response_model=AgencyBookingDTO, responses=error_responses(401, 403, 404))
async def get_booking(
    booking_id: BookingIdPath, user: AgencyDep, clock: ClockDep, background: BackgroundTasks
) -> dict[str, Any]:
    now = clock.now()
    await tracking_service.agency_booking(user, booking_id, now=now)  # ownership first (404)
    _after(background, await tracking_service.lazy_expire(booking_id, now), clock)
    return await tracking_service.agency_booking(user, booking_id, now=now)


@router.post(
    "/{booking_id}/accept", response_model=AgencyBookingDTO, responses=error_responses(401, 403, 404, 409, 410)
)
async def accept(
    booking_id: BookingIdPath, user: AgencyDep, clock: ClockDep, background: BackgroundTasks
) -> dict[str, Any]:
    now = clock.now()
    _after(background, await booking_service.accept(user, booking_id, now=now), clock)
    return await tracking_service.agency_booking(user, booking_id, now=now)


@router.post(
    "/{booking_id}/reject", response_model=AgencyBookingDTO, responses=error_responses(401, 403, 404, 409, 410)
)
async def reject(
    booking_id: BookingIdPath, body: RejectBookingBody, user: AgencyDep, clock: ClockDep, background: BackgroundTasks
) -> dict[str, Any]:
    now = clock.now()
    _after(background, await booking_service.reject(user, booking_id, body.reason, now=now), clock)
    return await tracking_service.agency_booking(user, booking_id, now=now)
