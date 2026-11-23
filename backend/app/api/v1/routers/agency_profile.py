"""E48–E51: agency profile and verification (role ``agency``). Owner: D3."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.context import CurrentUser
from app.deps import ClockDep, PlaceResolverDep, require_role
from app.schemas.agency import AgencyProfileResponse, AgencyVerificationStatusDTO, EmptyBody
from app.schemas.errors import error_responses
from app.schemas.profile import AgencyProfilePatch
from app.services import agency_service

router = APIRouter(prefix="/agency", tags=["agency"])
AgencyDep = Annotated[CurrentUser, Depends(require_role("agency"))]


@router.get("/profile", response_model=AgencyProfileResponse)
async def get_profile(user: AgencyDep) -> AgencyProfileResponse:
    return await agency_service.get_profile(user)


@router.patch("/profile", response_model=AgencyProfileResponse, responses=error_responses(400, 422, 502, 503))
async def patch_profile(
    user: AgencyDep, body: AgencyProfilePatch, clock: ClockDep, places: PlaceResolverDep
) -> AgencyProfileResponse:
    place = await places.resolve_place_id(body.base.place_id)
    return await agency_service.patch_profile(user, body, place, clock.now())


@router.get("/verification", response_model=AgencyVerificationStatusDTO)
async def verification(user: AgencyDep) -> AgencyVerificationStatusDTO:
    return await agency_service.verification_status(user)


@router.post("/verification", response_model=AgencyProfileResponse, responses=error_responses(409))
async def submit_verification(
    user: AgencyDep, clock: ClockDep, _body: EmptyBody | None = None
) -> AgencyProfileResponse:
    return await agency_service.submit_verification(user, clock.now())
