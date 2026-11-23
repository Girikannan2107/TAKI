"""E87–E91: driver trips, checkpoint arrive / depart (index 0 depart starts the trip) and complete.
Owner: D4. No location fields are accepted: positions are never collected or fabricated."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, Path

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.deps import require_role
from app.schemas.driver import CheckpointActionBody, DriverTripDTO, DriverTripFilter, DriverTripList
from app.schemas.errors import error_responses
from app.services import jobs_service, tracking_service

router = APIRouter(prefix="/driver/trips", tags=["driver"])

DriverDep = Annotated[CurrentUser, Depends(require_role("driver"))]
ClockDep = Annotated[Clock, Depends(get_clock)]
TripIdPath = Annotated[str, Path(pattern=r"^trp_[a-z0-9]{20}$")]
IndexPath = Annotated[int, Path(ge=0, le=9)]


def _after(background: BackgroundTasks, jobs: list[str], clock: Clock) -> None:
    if jobs:
        background.add_task(jobs_service.run_jobs, list(jobs), clock.now())


@router.get("", response_model=DriverTripList, responses=error_responses(401, 403))
async def list_trips(user: DriverDep, clock: ClockDep, status: DriverTripFilter = "upcoming") -> dict[str, Any]:
    return await tracking_service.driver_trips(user, status, now=clock.now())


@router.get("/{trip_id}", response_model=DriverTripDTO, responses=error_responses(401, 403, 404))
async def get_trip(trip_id: TripIdPath, user: DriverDep, clock: ClockDep) -> dict[str, Any]:
    return await tracking_service.driver_trip(user, trip_id, now=clock.now())


async def _checkpoint(
    kind: str,
    trip_id: str,
    index: int,
    body: CheckpointActionBody | None,
    user: CurrentUser,
    clock: Clock,
    bg: BackgroundTasks,
) -> dict[str, Any]:
    await tracking_service.ensure_driver_linked(user)
    now = clock.now()
    jobs = await tracking_service.checkpoint(
        user,
        trip_id,
        index,
        kind,  # type: ignore[arg-type]
        remarks=body.remarks if body else None,
        client_at=body.client_at if body else None,
        now=now,
    )
    _after(bg, jobs, clock)
    return await tracking_service.driver_trip(user, trip_id, now=now)


@router.post(
    "/{trip_id}/checkpoints/{index}/arrive", response_model=DriverTripDTO, responses=error_responses(401, 403, 404, 409)
)
async def arrive(
    trip_id: TripIdPath,
    index: IndexPath,
    user: DriverDep,
    clock: ClockDep,
    background: BackgroundTasks,
    body: CheckpointActionBody | None = None,
) -> dict[str, Any]:
    return await _checkpoint("arrive", trip_id, index, body, user, clock, background)


@router.post(
    "/{trip_id}/checkpoints/{index}/depart",
    response_model=DriverTripDTO,
    responses=error_responses(401, 403, 404, 409, 422),
)
async def depart(
    trip_id: TripIdPath,
    index: IndexPath,
    user: DriverDep,
    clock: ClockDep,
    background: BackgroundTasks,
    body: CheckpointActionBody | None = None,
) -> dict[str, Any]:
    return await _checkpoint("depart", trip_id, index, body, user, clock, background)


@router.post("/{trip_id}/complete", response_model=DriverTripDTO, responses=error_responses(401, 403, 404, 409))
async def complete(
    trip_id: TripIdPath, user: DriverDep, clock: ClockDep, background: BackgroundTasks
) -> dict[str, Any]:
    await tracking_service.ensure_driver_linked(user)
    now = clock.now()
    _after(background, await tracking_service.complete_trip(user, trip_id, now=now), clock)
    return await tracking_service.driver_trip(user, trip_id, now=now)
