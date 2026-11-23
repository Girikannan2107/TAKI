"""E52–E59: agency fleet (role ``agency``). Owner: D3."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Path, Query, Response, UploadFile

from app.core.context import CurrentUser
from app.core.errors import AppError
from app.deps import ClockDep, require_role
from app.schemas.agency import VehicleBody, VehicleDTO, VehiclePatchBody
from app.schemas.common import Items
from app.schemas.errors import error_responses
from app.services import vehicle_service

router = APIRouter(prefix="/agency/vehicles", tags=["agency"])
AgencyDep = Annotated[CurrentUser, Depends(require_role("agency"))]
VehicleIdPath = Annotated[str, Path(pattern=r"^veh_[a-z0-9]{20}$")]
FileIdPath = Annotated[str, Path(pattern=r"^fil_[a-z0-9]{20}$")]


async def _read(upload: UploadFile | None) -> bytes | None:
    if upload is None:
        return None
    return (await upload.read()) or None


@router.get("", response_model=Items[VehicleDTO])
async def list_vehicles(
    user: AgencyDep, status: Annotated[Literal["active", "inactive", "all"], Query()] = "all"
) -> Items[VehicleDTO]:
    return await vehicle_service.list_vehicles(user, status)


@router.post("", status_code=201, response_model=VehicleDTO, responses=error_responses(400, 403, 409))
async def create_vehicle(user: AgencyDep, body: VehicleBody, clock: ClockDep) -> VehicleDTO:
    return await vehicle_service.create_vehicle(user, body, clock.now())


@router.get("/{vehicle_id}", response_model=VehicleDTO, responses=error_responses(404))
async def get_vehicle(user: AgencyDep, vehicle_id: VehicleIdPath) -> VehicleDTO:
    return await vehicle_service.get_vehicle(user, vehicle_id)


@router.patch("/{vehicle_id}", response_model=VehicleDTO, responses=error_responses(400, 403, 404, 409))
async def update_vehicle(
    user: AgencyDep, vehicle_id: VehicleIdPath, body: VehiclePatchBody, clock: ClockDep
) -> VehicleDTO:
    return await vehicle_service.update_vehicle(user, vehicle_id, body, clock.now())


@router.delete("/{vehicle_id}", status_code=204, response_class=Response, responses=error_responses(403, 404, 409))
async def remove_vehicle(user: AgencyDep, vehicle_id: VehicleIdPath, clock: ClockDep) -> Response:
    await vehicle_service.remove_vehicle(user, vehicle_id, clock.now())
    return Response(status_code=204)


@router.post(
    "/{vehicle_id}/photos",
    status_code=201,
    response_model=VehicleDTO,
    responses=error_responses(400, 403, 404, 409, 413, 422, 429),
)
async def add_photo(
    user: AgencyDep, vehicle_id: VehicleIdPath, clock: ClockDep, photo: Annotated[UploadFile, File()]
) -> VehicleDTO:
    data = await _read(photo)
    if not data:
        raise AppError("invalid_request", "A required file is missing.", fields={"photo": "Required"})
    return await vehicle_service.add_photo(user, vehicle_id, data, clock.now())


@router.delete("/{vehicle_id}/photos/{file_id}", response_model=VehicleDTO, responses=error_responses(404))
async def remove_photo(user: AgencyDep, vehicle_id: VehicleIdPath, file_id: FileIdPath, clock: ClockDep) -> VehicleDTO:
    return await vehicle_service.remove_photo(user, vehicle_id, file_id, clock.now())


@router.put(
    "/{vehicle_id}/documents/rc",
    response_model=VehicleDTO,
    responses=error_responses(400, 403, 404, 409, 413, 422, 429),
)
async def upload_rc(
    user: AgencyDep,
    vehicle_id: VehicleIdPath,
    clock: ClockDep,
    file: Annotated[UploadFile, File()],
    back_file: Annotated[UploadFile | None, File(alias="backFile")] = None,
    valid_until: Annotated[str | None, Form(alias="validUntil")] = None,
) -> VehicleDTO:
    front = await _read(file)
    if not front:
        raise AppError("invalid_request", "A required file is missing.", fields={"file": "Required"})
    return await vehicle_service.upload_rc(
        user, vehicle_id, front, await _read(back_file), valid_until or None, clock.now()
    )
