"""E69–E79: agency trips (role ``agency``). Owner: D3."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import AwareDatetime

from app.core.context import CurrentUser
from app.deps import ClockDep, require_role
from app.schemas.agency import (
    AgencyTripDTO,
    CancelTripBody,
    EmptyBody,
    ReassignBody,
    TripBody,
    TripFormOptionsDTO,
    TripListResponse,
    TripPatchBody,
    TripPreviewBody,
    TripPreviewDTO,
    TripTab,
)
from app.schemas.errors import error_responses
from app.services import trip_service

router = APIRouter(prefix="/agency/trips", tags=["agency"])
AgencyDep = Annotated[CurrentUser, Depends(require_role("agency"))]
TripIdPath = Annotated[str, Path(pattern=r"^trp_[a-z0-9]{20}$")]
_PUBLISH_ERRORS = error_responses(400, 403, 404, 409, 422, 502, 503)


@router.get("/form-options", response_model=TripFormOptionsDTO)
async def form_options(
    user: AgencyDep,
    clock: ClockDep,
    departure_at: Annotated[AwareDatetime | None, Query(alias="departureAt")] = None,
    arrival_at: Annotated[AwareDatetime | None, Query(alias="arrivalAt")] = None,
    exclude_trip_id: Annotated[str | None, Query(alias="excludeTripId", pattern=r"^trp_[a-z0-9]{20}$")] = None,
) -> TripFormOptionsDTO:
    return await trip_service.form_options(user, departure_at, arrival_at, exclude_trip_id, clock.now())


@router.post("/preview", response_model=TripPreviewDTO, responses=error_responses(400, 422, 502, 503))
async def preview(user: AgencyDep, body: TripPreviewBody, clock: ClockDep) -> TripPreviewDTO:
    return await trip_service.preview(user, body, clock.now())


@router.get("", response_model=TripListResponse)
async def list_trips(
    user: AgencyDep,
    clock: ClockDep,
    tab: Annotated[TripTab, Query()] = "upcoming",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> TripListResponse:
    return await trip_service.list_trips(user, tab, limit, cursor, clock.now())


@router.post("", status_code=201, response_model=AgencyTripDTO, responses=_PUBLISH_ERRORS)
async def create_trip(user: AgencyDep, body: TripBody, clock: ClockDep) -> AgencyTripDTO:
    return await trip_service.create_trip(user, body, clock.now())


@router.get("/{trip_id}", response_model=AgencyTripDTO, responses=error_responses(404))
async def get_trip(user: AgencyDep, trip_id: TripIdPath, clock: ClockDep) -> AgencyTripDTO:
    return await trip_service.get_trip(user, trip_id, clock.now())


@router.patch("/{trip_id}", response_model=AgencyTripDTO, responses=_PUBLISH_ERRORS)
async def update_trip(user: AgencyDep, trip_id: TripIdPath, body: TripPatchBody, clock: ClockDep) -> AgencyTripDTO:
    return await trip_service.update_trip(user, trip_id, body, clock.now())


@router.delete("/{trip_id}", status_code=204, response_class=Response, responses=error_responses(404, 409))
async def delete_trip(user: AgencyDep, trip_id: TripIdPath) -> Response:
    await trip_service.delete_draft(user, trip_id)
    return Response(status_code=204)


@router.post("/{trip_id}/publish", response_model=AgencyTripDTO, responses=_PUBLISH_ERRORS)
async def publish(
    user: AgencyDep, trip_id: TripIdPath, clock: ClockDep, _body: EmptyBody | None = None
) -> AgencyTripDTO:
    return await trip_service.publish_trip(user, trip_id, clock.now())


@router.post("/{trip_id}/unpublish", response_model=AgencyTripDTO, responses=error_responses(404, 409))
async def unpublish(
    user: AgencyDep, trip_id: TripIdPath, clock: ClockDep, _body: EmptyBody | None = None
) -> AgencyTripDTO:
    return await trip_service.unpublish_trip(user, trip_id, clock.now())


@router.post("/{trip_id}/cancel", response_model=AgencyTripDTO, responses=error_responses(400, 404, 409))
async def cancel(user: AgencyDep, trip_id: TripIdPath, body: CancelTripBody, clock: ClockDep) -> AgencyTripDTO:
    return await trip_service.cancel_trip(user, trip_id, body.reason, clock.now())


@router.post("/{trip_id}/reassign", response_model=AgencyTripDTO, responses=_PUBLISH_ERRORS)
async def reassign(user: AgencyDep, trip_id: TripIdPath, body: ReassignBody, clock: ClockDep) -> AgencyTripDTO:
    return await trip_service.reassign(user, trip_id, body.driver_id, body.vehicle_id, clock.now())
