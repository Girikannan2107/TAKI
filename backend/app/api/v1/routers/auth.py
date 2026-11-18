"""E4–E11: phone status, signup ×3, login, password reset, logout, session."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Request, Response, status

from app.deps import ClockDep, PhoneProofDep, PlaceResolverDep, UserDep, bearer_token
from app.middleware.rate_limit import client_ip
from app.schemas.auth import (
    AgencySignupBody,
    AuthResultDTO,
    CustomerSignupBody,
    DriverSignupBody,
    LoginBody,
    LogoutBody,
    PhoneStatusResponse,
    ResetPasswordBody,
    SessionResponse,
)
from app.schemas.errors import error_responses
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/phone/status",
    response_model=PhoneStatusResponse,
    responses=error_responses(401, 429),
)
async def phone_status(proof: PhoneProofDep, clock: ClockDep) -> PhoneStatusResponse:
    return await auth_service.phone_status(proof, clock.now())


@router.post(
    "/signup/customer",
    status_code=status.HTTP_201_CREATED,
    response_model=AuthResultDTO,
    responses=error_responses(400, 401, 409, 422, 429),
)
async def signup_customer(proof: PhoneProofDep, body: CustomerSignupBody, clock: ClockDep) -> AuthResultDTO:
    return await auth_service.signup_customer(proof, body, clock.now())


@router.post(
    "/signup/agency",
    status_code=status.HTTP_201_CREATED,
    response_model=AuthResultDTO,
    responses=error_responses(400, 401, 409, 422, 429, 502, 503),
)
async def signup_agency(
    proof: PhoneProofDep, body: AgencySignupBody, clock: ClockDep, places: PlaceResolverDep
) -> AuthResultDTO:
    place = await places.resolve_place_id(body.base.place_id)
    return await auth_service.signup_agency(proof, body, clock.now(), place)


@router.post(
    "/signup/driver",
    status_code=status.HTTP_201_CREATED,
    response_model=AuthResultDTO,
    responses=error_responses(400, 401, 404, 409, 429),
)
async def signup_driver(proof: PhoneProofDep, body: DriverSignupBody, clock: ClockDep) -> AuthResultDTO:
    return await auth_service.signup_driver(proof, body, clock.now())


@router.post("/login", response_model=AuthResultDTO, responses=error_responses(400, 401, 403, 423, 429))
async def login(body: LoginBody, request: Request, clock: ClockDep) -> AuthResultDTO:
    return await auth_service.login(body, client_ip(request), clock.now())


@router.post("/password/reset", response_model=AuthResultDTO, responses=error_responses(400, 401, 403, 404, 429))
async def reset_password(proof: PhoneProofDep, body: ResetPasswordBody, clock: ClockDep) -> AuthResultDTO:
    return await auth_service.reset_password(proof, body, clock.now())


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(401, 403))
async def logout(user: UserDep, clock: ClockDep, body: LogoutBody | None = None) -> Response:
    await auth_service.logout(user, bool(body and body.all_devices), clock.now())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/session", response_model=SessionResponse)
async def session(authorization: Annotated[str | None, Header()] = None) -> SessionResponse:
    return SessionResponse(user=await auth_service.session_from_token(bearer_token(authorization)))
