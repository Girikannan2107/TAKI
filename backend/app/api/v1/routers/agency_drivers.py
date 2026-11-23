"""E60–E68: agency drivers and invites (role ``agency``). Owner: D3."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Response

from app.core.context import CurrentUser
from app.deps import ClockDep, require_role
from app.schemas.agency import (
    AgencyDriverDetailDTO,
    AgencyDriverDTO,
    DriverInviteBody,
    DriverPatchBody,
    DriverRejectBody,
    EmptyBody,
    InviteDTO,
)
from app.schemas.common import Items
from app.schemas.errors import error_responses
from app.services import driver_mgmt_service as svc

router = APIRouter(prefix="/agency", tags=["agency"])
AgencyDep = Annotated[CurrentUser, Depends(require_role("agency"))]
DriverIdPath = Annotated[str, Path(pattern=r"^[A-Za-z0-9]{1,128}$")]
InviteIdPath = Annotated[str, Path(pattern=r"^inv_[a-z0-9]{20}$")]


@router.get("/drivers", response_model=Items[AgencyDriverDTO])
async def list_drivers(
    user: AgencyDep,
    clock: ClockDep,
    status: Annotated[Literal["active", "pending", "removed"], Query()] = "active",
) -> Items[AgencyDriverDTO]:
    return await svc.list_drivers(user, status, clock.now())


@router.get("/drivers/{driver_id}", response_model=AgencyDriverDetailDTO, responses=error_responses(404))
async def get_driver(user: AgencyDep, driver_id: DriverIdPath, clock: ClockDep) -> AgencyDriverDetailDTO:
    return await svc.get_driver(user, driver_id, clock.now())


@router.patch("/drivers/{driver_id}", response_model=AgencyDriverDTO, responses=error_responses(403, 404, 409))
async def patch_driver(
    user: AgencyDep, driver_id: DriverIdPath, body: DriverPatchBody, clock: ClockDep
) -> AgencyDriverDTO:
    return await svc.set_availability(user, driver_id, body.availability, clock.now())


@router.post("/drivers/{driver_id}/approve", response_model=AgencyDriverDTO, responses=error_responses(403, 404, 409))
async def approve_driver(
    user: AgencyDep, driver_id: DriverIdPath, clock: ClockDep, _body: EmptyBody | None = None
) -> AgencyDriverDTO:
    return await svc.approve_driver(user, driver_id, clock.now())


@router.post("/drivers/{driver_id}/reject", response_model=AgencyDriverDTO, responses=error_responses(403, 404, 409))
async def reject_driver(
    user: AgencyDep, driver_id: DriverIdPath, clock: ClockDep, body: DriverRejectBody | None = None
) -> AgencyDriverDTO:
    return await svc.reject_driver(user, driver_id, body.reason if body else None, clock.now())


@router.delete(
    "/drivers/{driver_id}", status_code=204, response_class=Response, responses=error_responses(403, 404, 409)
)
async def remove_driver(user: AgencyDep, driver_id: DriverIdPath, clock: ClockDep) -> Response:
    await svc.remove_driver(user, driver_id, clock.now())
    return Response(status_code=204)


@router.get("/driver-invites", response_model=Items[InviteDTO])
async def list_invites(user: AgencyDep, clock: ClockDep) -> Items[InviteDTO]:
    return await svc.list_invites(user, clock.now())


@router.post("/driver-invites", status_code=201, response_model=InviteDTO, responses=error_responses(400, 403, 409))
async def create_invite(user: AgencyDep, body: DriverInviteBody, clock: ClockDep) -> InviteDTO:
    return await svc.create_invite(user, body, clock.now())


@router.delete(
    "/driver-invites/{invite_id}",
    status_code=204,
    response_class=Response,
    responses=error_responses(403, 404, 409),
)
async def revoke_invite(user: AgencyDep, invite_id: InviteIdPath, clock: ClockDep) -> Response:
    await svc.revoke_invite(user, invite_id, clock.now())
    return Response(status_code=204)
