"""E34–E41: customer bookings (request, list, counts, detail, cancel, OTP, tracking, review). Owner: D4.

After-commit refund jobs run as ``BackgroundTasks``; the sweep retries them.
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Path, Query, Request, Response

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.deps import require_role
from app.middleware.rate_limit import client_ip, rate_limit
from app.models.enums import CustomerTab
from app.schemas.customer import (
    BookingPage,
    CancelBookingBody,
    CustomerBookingDTO,
    OtpsResponse,
    RegenerateOtpBody,
    RequestBookingBody,
    ReviewBody,
    ReviewDTO,
    TrackingDTO,
)
from app.schemas.errors import error_responses
from app.services import booking_service, jobs_service, tracking_service
from app.views.bookings import review_dto

router = APIRouter(prefix="/customer/bookings", tags=["customer"])

CustomerDep = Annotated[CurrentUser, Depends(require_role("customer"))]
ClockDep = Annotated[Clock, Depends(get_clock)]
BookingIdPath = Annotated[str, Path(pattern=r"^TAKI\d{8}$")]
IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,128}$")


def idempotency_key(idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> str:
    if not idempotency_key:
        raise AppError("idempotency_key_required")
    if not IDEMPOTENCY_RE.match(idempotency_key):
        raise AppError("invalid_request", fields={"Idempotency-Key": "Invalid idempotency key"})
    return idempotency_key


def _uid_key(request: Request) -> str:
    return str(getattr(request.state, "uid", None) or client_ip(request))


def after_commit(background: BackgroundTasks, job_ids: list[str], clock: Clock) -> None:
    if job_ids:
        background.add_task(jobs_service.run_jobs, list(job_ids), clock.now())


@router.post(
    "",
    status_code=201,
    response_model=CustomerBookingDTO,
    responses=error_responses(400, 401, 403, 404, 409, 422, 429),
)
async def request_booking(
    body: RequestBookingBody,
    response: Response,
    user: CustomerDep,
    clock: ClockDep,
    key: Annotated[str, Depends(idempotency_key)],
    _rl: Annotated[None, Depends(rate_limit("booking_create_uid", _uid_key))],
) -> dict[str, Any]:
    now = clock.now()
    r = await booking_service.request_booking(
        user, shipment_id=body.shipment_id, trip_id=body.trip_id, idempotency_key=key, now=now
    )
    if r.replayed:
        response.status_code = 200
    return await tracking_service.customer_booking(user, r.booking["id"], now=now)


@router.get("", response_model=BookingPage, responses=error_responses(401, 403))
async def list_bookings(
    user: CustomerDep,
    tab: CustomerTab | None = None,
    active: bool = False,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> dict[str, Any]:
    return await tracking_service.customer_bookings(user, tab=tab, active=active, limit=limit, cursor=cursor)


@router.get("/counts", response_model=dict[str, int], responses=error_responses(401, 403))
async def booking_counts(user: CustomerDep) -> dict[str, int]:
    return await tracking_service.customer_counts(user)


@router.get("/{booking_id}", response_model=CustomerBookingDTO, responses=error_responses(401, 403, 404))
async def get_booking(
    booking_id: BookingIdPath, user: CustomerDep, clock: ClockDep, background: BackgroundTasks
) -> dict[str, Any]:
    now = clock.now()
    await tracking_service.customer_booking(user, booking_id, now=now)  # ownership first (404)
    after_commit(background, await tracking_service.lazy_expire(booking_id, now), clock)
    return await tracking_service.customer_booking(user, booking_id, now=now)


@router.post("/{booking_id}/cancel", response_model=CustomerBookingDTO, responses=error_responses(401, 403, 404, 409))
async def cancel_booking(
    booking_id: BookingIdPath,
    user: CustomerDep,
    clock: ClockDep,
    background: BackgroundTasks,
    body: CancelBookingBody | None = None,
) -> dict[str, Any]:
    now = clock.now()
    jobs = await booking_service.cancel_by_customer(user, booking_id, body.reason if body else None, now=now)
    after_commit(background, jobs, clock)
    return await tracking_service.customer_booking(user, booking_id, now=now)


@router.post("/{booking_id}/otp/regenerate", response_model=OtpsResponse, responses=error_responses(401, 403, 404, 409))
async def regenerate_otp(
    booking_id: BookingIdPath, body: RegenerateOtpBody, user: CustomerDep, clock: ClockDep
) -> dict[str, Any]:
    now = clock.now()
    await booking_service.regenerate_otp(user, booking_id, body.which, now=now)
    view = await tracking_service.customer_booking(user, booking_id, now=now)
    return {"otps": view["otps"]}


@router.get("/{booking_id}/tracking", response_model=TrackingDTO, responses=error_responses(401, 403, 404))
async def tracking(booking_id: BookingIdPath, user: CustomerDep) -> dict[str, Any]:
    return await tracking_service.customer_tracking(user, booking_id)


@router.post(
    "/{booking_id}/review", status_code=201, response_model=ReviewDTO, responses=error_responses(401, 403, 404, 409)
)
async def review(booking_id: BookingIdPath, body: ReviewBody, user: CustomerDep, clock: ClockDep) -> dict[str, Any]:
    doc = await booking_service.review(user, booking_id, body.rating, body.comment, now=clock.now())
    out = review_dto(doc)
    assert out is not None  # noqa: S101
    return out
