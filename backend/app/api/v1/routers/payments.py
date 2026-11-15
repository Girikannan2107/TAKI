"""E42–E46: Cashfree payments, plus the dev-only test gateway confirm. Owner: D5.

The webhook reads the raw body (never re-serialised) and is authenticated by Cashfree's signature.
After-commit refund jobs run as ``BackgroundTasks`` (the sweep retries them).
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Path, Query, Request, Response

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.core.logging import request_id_var
from app.deps import require_role
from app.middleware.rate_limit import client_ip, rate_limit
from app.schemas.errors import error_responses
from app.schemas.payments import (
    CreatePaymentOrderBody,
    CreatePaymentOrderResponse,
    DevConfirmBody,
    PaymentHistoryPage,
    PaymentStatusResponse,
    WebhookAck,
)
from app.services import jobs_service
from app.services.payment_service import PaymentService, get_payment_service

router = APIRouter(prefix="/payments", tags=["payments"])

IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,128}$")
PaymentIdPath = Annotated[str, Path(pattern=r"^pay_[a-z0-9]{20}$")]
CustomerDep = Annotated[CurrentUser, Depends(require_role("customer"))]
ServiceDep = Annotated[PaymentService, Depends(get_payment_service)]
ClockDep = Annotated[Clock, Depends(get_clock)]


def _uid_key(request: Request) -> str:
    return str(getattr(request.state, "uid", None) or client_ip(request))


def _after_commit(background: BackgroundTasks, job_ids: list[str], clock: Clock) -> None:
    if job_ids:
        background.add_task(jobs_service.run_jobs, list(job_ids), clock.now())


def idempotency_key(idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None) -> str:
    if not idempotency_key:
        raise AppError("idempotency_key_required")
    if not IDEMPOTENCY_RE.match(idempotency_key):
        raise AppError("invalid_request", fields={"Idempotency-Key": "Invalid idempotency key"})
    return idempotency_key


@router.post(
    "/orders",
    response_model=CreatePaymentOrderResponse,
    status_code=201,
    responses=error_responses(400, 401, 403, 404, 409, 410, 422, 429, 501, 502),
)
async def create_order(
    body: CreatePaymentOrderBody,
    response: Response,
    user: CustomerDep,
    service: ServiceDep,
    clock: ClockDep,
    key: Annotated[str, Depends(idempotency_key)],
    _rl: Annotated[None, Depends(rate_limit("payment_create_uid", _uid_key))],
) -> CreatePaymentOrderResponse:
    result = await service.create_order(user, body.booking_id, key, now=clock.now(), request_id=request_id_var.get())
    if not result.created:
        response.status_code = 200
    return result.response


@router.get("/history", response_model=PaymentHistoryPage, responses=error_responses(401, 403))
async def payment_history(
    user: CustomerDep,
    service: ServiceDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> PaymentHistoryPage:
    return await service.history(user, limit=limit, cursor=cursor)


@router.post(
    "/cashfree/webhook",
    response_model=WebhookAck,
    responses=error_responses(401, 501),
    include_in_schema=True,
)
async def cashfree_webhook(
    request: Request, background: BackgroundTasks, service: ServiceDep, clock: ClockDep
) -> WebhookAck:
    raw = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    result = await service.handle_cashfree_webhook(raw, headers, now=clock.now(), request_id=request_id_var.get())
    _after_commit(background, result.job_ids, clock)
    return WebhookAck(ok=True, outcome=result.outcome)


@router.post(
    "/dev/confirm",
    response_model=PaymentStatusResponse,
    responses=error_responses(401, 403, 404),
    include_in_schema=False,  # local/e2e only: 404 unless PAYMENT_PROVIDER=dev in development/test
)
async def dev_confirm(
    body: DevConfirmBody, background: BackgroundTasks, user: CustomerDep, service: ServiceDep, clock: ClockDep
) -> PaymentStatusResponse:
    status, jobs = await service.dev_confirm(user, body.payment_id, body.outcome, body.dev_token, now=clock.now())
    _after_commit(background, jobs, clock)
    return status


@router.get("/{payment_id}", response_model=PaymentStatusResponse, responses=error_responses(401, 403, 404))
async def get_payment(
    payment_id: PaymentIdPath, user: CustomerDep, service: ServiceDep, clock: ClockDep
) -> PaymentStatusResponse:
    return await service.get_status(user, payment_id, now=clock.now())


@router.post(
    "/{payment_id}/verify",
    response_model=PaymentStatusResponse,
    responses=error_responses(401, 403, 404, 429, 501, 502),
)
async def verify_payment(
    payment_id: PaymentIdPath,
    background: BackgroundTasks,
    user: CustomerDep,
    service: ServiceDep,
    clock: ClockDep,
    _rl: Annotated[None, Depends(rate_limit("payment_verify_uid", _uid_key))],
) -> PaymentStatusResponse:
    status, jobs = await service.verify(user, payment_id, now=clock.now(), request_id=request_id_var.get())
    _after_commit(background, jobs, clock)
    return status
