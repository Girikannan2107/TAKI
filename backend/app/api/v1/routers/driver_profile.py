"""E101–E103: the driver's own profile and agency link request (role ``driver``). Owner: D3."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.context import CurrentUser
from app.deps import ClockDep, require_role
from app.schemas.agency import AgencyLinkBody, DriverAppProfileDTO
from app.schemas.errors import error_responses
from app.schemas.profile import DriverProfilePatch
from app.services import driver_mgmt_service as svc

router = APIRouter(prefix="/driver", tags=["driver"])
DriverDep = Annotated[CurrentUser, Depends(require_role("driver"))]


@router.get("/profile", response_model=DriverAppProfileDTO)
async def get_profile(user: DriverDep) -> DriverAppProfileDTO:
    return await svc.driver_profile(user)


@router.patch("/profile", response_model=DriverAppProfileDTO, responses=error_responses(400))
async def patch_profile(user: DriverDep, body: DriverProfilePatch, clock: ClockDep) -> DriverAppProfileDTO:
    return await svc.patch_driver_profile(user, body, clock.now())


@router.post("/agency-link", response_model=DriverAppProfileDTO, responses=error_responses(400, 404, 409))
async def agency_link(user: DriverDep, body: AgencyLinkBody, clock: ClockDep) -> DriverAppProfileDTO:
    return await svc.request_agency_link(user, body.agency_id, clock.now())
