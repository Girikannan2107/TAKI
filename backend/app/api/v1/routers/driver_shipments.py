"""E92–E99: driver shipments — list, detail (contact access rule), pickup with OTP, refuse pickup,
manual transit steps, delivery with OTP + optional photo proof, remarks. Owner: D4."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Path, Query, UploadFile
from pydantic import TypeAdapter, ValidationError

from app.core.clock import Clock, get_clock
from app.core.constants import PROOF_BYTES
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.deps import require_role
from app.domain import booking_machine as bm
from app.repositories import bookings as bookings_repo
from app.schemas.driver import (
    CheckpointActionBody,
    ClientAt,
    DriverEventDTO,
    DriverShipmentDTO,
    DriverShipmentPage,
    DriverShipmentTab,
    PickupBody,
    RefusePickupBody,
    RemarkBody,
)
from app.schemas.errors import error_responses
from app.services import booking_service, file_service, jobs_service, tracking_service
from app.views.driver import event_dto

router = APIRouter(prefix="/driver/shipments", tags=["driver"])

DriverDep = Annotated[CurrentUser, Depends(require_role("driver"))]
ClockDep = Annotated[Clock, Depends(get_clock)]
BookingIdPath = Annotated[str, Path(pattern=r"^TAKI\d{8}$")]


async def linked_driver(user: DriverDep) -> CurrentUser:
    await tracking_service.ensure_driver_linked(user)
    return user


LinkedDep = Annotated[CurrentUser, Depends(linked_driver)]


def _after(background: BackgroundTasks, jobs: list[str], clock: Clock) -> None:
    if jobs:
        background.add_task(jobs_service.run_jobs, list(jobs), clock.now())


@router.get("", response_model=DriverShipmentPage, responses=error_responses(401, 403))
async def list_shipments(
    user: LinkedDep,
    tab: DriverShipmentTab = "pending_pickup",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> dict[str, Any]:
    return await tracking_service.driver_shipments(user, tab, limit=limit, cursor=cursor)


@router.get("/{booking_id}", response_model=DriverShipmentDTO, responses=error_responses(401, 403, 404))
async def get_shipment(booking_id: BookingIdPath, user: LinkedDep) -> dict[str, Any]:
    return await tracking_service.driver_shipment(user, booking_id)


@router.post(
    "/{booking_id}/pickup", response_model=DriverShipmentDTO, responses=error_responses(401, 403, 404, 409, 422)
)
async def pickup(booking_id: BookingIdPath, body: PickupBody, user: LinkedDep, clock: ClockDep) -> dict[str, Any]:
    await booking_service.pickup(
        user, booking_id, body.otp, remarks=body.remarks, client_at=body.client_at, now=clock.now()
    )
    return await tracking_service.driver_shipment(user, booking_id)


@router.post(
    "/{booking_id}/refuse-pickup", response_model=DriverShipmentDTO, responses=error_responses(401, 403, 404, 409)
)
async def refuse_pickup(
    booking_id: BookingIdPath, body: RefusePickupBody, user: LinkedDep, clock: ClockDep, background: BackgroundTasks
) -> dict[str, Any]:
    _after(background, await booking_service.refuse_pickup(user, booking_id, body.reason, now=clock.now()), clock)
    return await tracking_service.driver_shipment(user, booking_id)


@router.post(
    "/{booking_id}/start-transit", response_model=DriverShipmentDTO, responses=error_responses(401, 403, 404, 409)
)
async def start_transit(
    booking_id: BookingIdPath, user: LinkedDep, clock: ClockDep, body: CheckpointActionBody | None = None
) -> dict[str, Any]:
    await booking_service.manual_step(
        user,
        booking_id,
        "start_transit",
        remarks=body.remarks if body else None,
        client_at=body.client_at if body else None,
        now=clock.now(),
    )
    return await tracking_service.driver_shipment(user, booking_id)


@router.post(
    "/{booking_id}/out-for-delivery", response_model=DriverShipmentDTO, responses=error_responses(401, 403, 404, 409)
)
async def out_for_delivery(
    booking_id: BookingIdPath, user: LinkedDep, clock: ClockDep, body: CheckpointActionBody | None = None
) -> dict[str, Any]:
    await booking_service.manual_step(
        user,
        booking_id,
        "out_for_delivery",
        remarks=body.remarks if body else None,
        client_at=body.client_at if body else None,
        now=clock.now(),
    )
    return await tracking_service.driver_shipment(user, booking_id)


def _parse_client_at(v: str | None) -> datetime | None:
    try:
        return TypeAdapter(ClientAt).validate_python(v or None)
    except ValidationError as e:
        raise AppError("invalid_request", fields={"clientAt": "Enter a date-time with a time zone"}) from e


@router.post(
    "/{booking_id}/deliver", response_model=DriverShipmentDTO, responses=error_responses(401, 403, 404, 409, 413, 422)
)
async def deliver(
    booking_id: BookingIdPath,
    user: LinkedDep,
    clock: ClockDep,
    otp: Annotated[str, Form(pattern=r"^\d{6}$")],
    received_by: Annotated[str | None, Form(alias="receivedBy", max_length=80)] = None,
    remarks: Annotated[str | None, Form(max_length=300)] = None,
    client_at: Annotated[str | None, Form(alias="clientAt")] = None,
    proof: Annotated[list[UploadFile] | None, File()] = None,
) -> dict[str, Any]:
    now = clock.now()
    at = _parse_client_at(client_at)
    files = [f for f in (proof or []) if f is not None]
    if len(files) > bm.MAX_PROOF_FILES:
        raise AppError(
            "invalid_request", f"Add at most {bm.MAX_PROOF_FILES} photos.", fields={"proof": "Too many files"}
        )
    b = await bookings_repo.get(booking_id)
    if not booking_service.driver_can_see(b, user.uid):
        raise AppError("not_found")
    stored: list[str] = []
    try:
        for f in files:
            data = await f.read(PROOF_BYTES + 1)
            doc = await file_service.save_upload(
                data=data,
                kind="delivery_proof",
                owner_type="booking",
                owner_id=booking_id,
                uploaded_by=user.uid,
                now=now,
                field="proof",
                booking_id=booking_id,
            )
            stored.append(doc["id"])
        await booking_service.deliver(
            user,
            booking_id,
            otp,
            proof_file_ids=stored,
            remarks=remarks,
            received_by=received_by,
            client_at=at,
            now=now,
        )
    except Exception:
        if stored:
            await file_service.discard_uploads(stored, now)
        raise
    return await tracking_service.driver_shipment(user, booking_id)


@router.post(
    "/{booking_id}/remarks",
    status_code=201,
    response_model=DriverEventDTO,
    responses=error_responses(401, 403, 404, 409),
)
async def add_remark(booking_id: BookingIdPath, body: RemarkBody, user: LinkedDep, clock: ClockDep) -> dict[str, Any]:
    ev = await booking_service.add_remark(user, booking_id, body.text, now=clock.now())
    return event_dto(ev, user.uid)
