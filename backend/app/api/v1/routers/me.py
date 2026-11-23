"""E12–E18: me, profile, password, phone, photo, identity documents."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, File, Form, Path, UploadFile
from pydantic import ValidationError

from app.core.context import CurrentUser, PhoneProof
from app.core.errors import AppError
from app.core.exception_handlers import validation_error
from app.deps import ClockDep, PlaceResolverDep, UserDep, phone_proof_header, require_role
from app.schemas.auth import AuthResultDTO, ChangePasswordBody, ChangePhoneBody, SessionUserDTO
from app.schemas.errors import error_responses
from app.schemas.profile import (
    AdminProfileDTO,
    AgencyProfileDTO,
    AgencyProfilePatch,
    CustomerProfileDTO,
    CustomerProfilePatch,
    DocumentUploadResultDTO,
    DriverProfileDTO,
    DriverProfilePatch,
    PhotoResultDTO,
)
from app.services import auth_service, profile_service

router = APIRouter(prefix="/me", tags=["me"])

ProfileResponse = CustomerProfileDTO | AgencyProfileDTO | DriverProfileDTO | AdminProfileDTO
MemberDep = Annotated[CurrentUser, Depends(require_role("customer", "agency", "driver"))]
DocumentKind = Annotated[str, Path(pattern=r"^(aadhaar|pan|driving_license)$")]

_PATCH_MODELS: dict[str, type[CustomerProfilePatch | AgencyProfilePatch | DriverProfilePatch]] = {
    "customer": CustomerProfilePatch,
    "agency": AgencyProfilePatch,
    "driver": DriverProfilePatch,
}


async def _read(upload: UploadFile | None) -> bytes | None:
    if upload is None:
        return None
    data = await upload.read()
    return data or None


@router.get("", response_model=SessionUserDTO)
async def me(user: UserDep) -> SessionUserDTO:
    dto = await auth_service.session_user_for_uid(user.uid)
    if dto is None:
        raise AppError("unauthenticated")
    return dto


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(user: UserDep) -> Any:
    return await profile_service.get_profile(user)


@router.patch(
    "/profile",
    response_model=ProfileResponse,
    responses=error_responses(400, 422, 502, 503),
)
async def patch_profile(
    user: MemberDep,
    clock: ClockDep,
    places: PlaceResolverDep,
    payload: Annotated[dict[str, Any], Body()],
) -> Any:
    model = _PATCH_MODELS[user.role]
    try:
        body = model.model_validate(payload)
    except ValidationError as e:
        raise validation_error(e.errors()) from e
    place = None
    if isinstance(body, AgencyProfilePatch):
        place = await places.resolve_place_id(body.base.place_id)
    return await profile_service.patch_profile(user, body, clock.now(), place)


@router.post("/password", response_model=AuthResultDTO, responses=error_responses(400, 401, 423, 429))
async def change_password(user: UserDep, body: ChangePasswordBody, clock: ClockDep) -> AuthResultDTO:
    return await profile_service.change_password(user, body, clock.now())


@router.post("/phone", response_model=AuthResultDTO, responses=error_responses(400, 401, 409, 423, 429))
async def change_phone(
    user: MemberDep,
    body: ChangePhoneBody,
    clock: ClockDep,
    proof: Annotated[PhoneProof, Depends(phone_proof_header)],
) -> AuthResultDTO:
    return await profile_service.change_phone(user, body.current_password, proof, clock.now())


@router.put("/photo", response_model=PhotoResultDTO, responses=error_responses(400, 413, 415, 422, 429))
async def set_photo(user: MemberDep, clock: ClockDep, photo: Annotated[UploadFile, File()]) -> PhotoResultDTO:
    data = await _read(photo)
    if not data:
        raise AppError("invalid_request", "A required file is missing.", fields={"photo": "Required"})
    return await profile_service.set_photo(user, data, clock.now())


@router.put(
    "/documents/{kind}",
    response_model=DocumentUploadResultDTO,
    responses=error_responses(400, 403, 409, 413, 415, 422, 429),
)
async def upload_document(
    user: Annotated[CurrentUser, Depends(require_role("agency", "driver"))],
    clock: ClockDep,
    kind: DocumentKind,
    number: Annotated[str, Form(min_length=1, max_length=40)],
    file: Annotated[UploadFile, File()],
    valid_until: Annotated[str | None, Form(alias="validUntil")] = None,
    back_file: Annotated[UploadFile | None, File(alias="backFile")] = None,
) -> DocumentUploadResultDTO:
    front = await _read(file)
    if not front:
        raise AppError("invalid_request", "A required file is missing.", fields={"file": "Required"})
    return await profile_service.upload_document(
        user, kind, number, valid_until or None, front, await _read(back_file), clock.now()
    )
