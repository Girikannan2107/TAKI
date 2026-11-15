"""E108–E128: hidden admin console. Every route requires role ``admin``."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.core.context import CurrentUser
from app.deps import require_role
from app.models.enums import PaymentStatus
from app.schemas.admin import (
    AdminAgencyDetailDTO,
    AdminAgencyListItemDTO,
    AdminDriverDetailDTO,
    AdminDriverListItemDTO,
    AdminListStatus,
    AdminOverviewDTO,
    AdminPaymentRowDTO,
    AdminSettlementHistoryDTO,
    AdminSettlementListDTO,
    AdminSettlementResultDTO,
    AdminVehicleRcItemDTO,
    DisableUserBody,
    RejectBody,
    SettleBody,
    SuspendBody,
)
from app.schemas.common import Page
from app.schemas.errors import error_responses
from app.services import admin_service

router = APIRouter(prefix="/admin", tags=["admin"], responses=error_responses(401, 403))

Admin = Annotated[CurrentUser, Depends(require_role("admin"))]
AgencyIdPath = Annotated[str, Path(pattern=r"^agc_[a-z0-9]{20}$")]
VehicleIdPath = Annotated[str, Path(pattern=r"^veh_[a-z0-9]{20}$")]
PaymentIdPath = Annotated[str, Path(pattern=r"^pay_[a-z0-9]{20}$")]
UidPath = Annotated[str, Path(pattern=r"^[A-Za-z0-9]{1,128}$")]
Limit = Annotated[int, Query(ge=1, le=50)]
Cursor = Annotated[str | None, Query(max_length=512)]


@router.get("/overview", response_model=AdminOverviewDTO)
async def overview(_: Admin) -> AdminOverviewDTO:
    return await admin_service.overview()


# ── agencies ──────────────────────────────────────────────────────────────────
@router.get("/agencies", response_model=Page[AdminAgencyListItemDTO])
async def list_agencies(
    _: Admin,
    status_: Annotated[AdminListStatus, Query(alias="status")] = "pending",
    limit: Limit = 20,
    cursor: Cursor = None,
) -> Page[AdminAgencyListItemDTO]:
    return await admin_service.list_agencies(status_, limit, cursor)


@router.get("/agencies/{agency_id}", response_model=AdminAgencyDetailDTO, responses=error_responses(404))
async def get_agency(admin: Admin, agency_id: AgencyIdPath) -> AdminAgencyDetailDTO:
    return await admin_service.get_agency(admin, agency_id)


@router.post("/agencies/{agency_id}/verify", response_model=AdminAgencyDetailDTO, responses=error_responses(404, 409))
async def verify_agency(admin: Admin, agency_id: AgencyIdPath) -> AdminAgencyDetailDTO:
    return await admin_service.verify_agency(admin, agency_id)


@router.post(
    "/agencies/{agency_id}/reject", response_model=AdminAgencyDetailDTO, responses=error_responses(400, 404, 409)
)
async def reject_agency(admin: Admin, agency_id: AgencyIdPath, body: RejectBody) -> AdminAgencyDetailDTO:
    return await admin_service.reject_agency(admin, agency_id, body.reason)


@router.post(
    "/agencies/{agency_id}/suspend", response_model=AdminAgencyDetailDTO, responses=error_responses(400, 404, 409)
)
async def suspend_agency(admin: Admin, agency_id: AgencyIdPath, body: SuspendBody) -> AdminAgencyDetailDTO:
    return await admin_service.suspend_agency(admin, agency_id, body.reason)


@router.post(
    "/agencies/{agency_id}/reinstate", response_model=AdminAgencyDetailDTO, responses=error_responses(404, 409)
)
async def reinstate_agency(admin: Admin, agency_id: AgencyIdPath) -> AdminAgencyDetailDTO:
    return await admin_service.reinstate_agency(admin, agency_id)


# ── drivers ───────────────────────────────────────────────────────────────────
@router.get("/drivers", response_model=Page[AdminDriverListItemDTO])
async def list_drivers(
    _: Admin,
    status_: Annotated[AdminListStatus, Query(alias="status")] = "pending",
    limit: Limit = 20,
    cursor: Cursor = None,
) -> Page[AdminDriverListItemDTO]:
    return await admin_service.list_drivers(status_, limit, cursor)


@router.get("/drivers/{driver_id}", response_model=AdminDriverDetailDTO, responses=error_responses(404))
async def get_driver(admin: Admin, driver_id: UidPath) -> AdminDriverDetailDTO:
    return await admin_service.get_driver(admin, driver_id)


@router.post("/drivers/{driver_id}/verify", response_model=AdminDriverDetailDTO, responses=error_responses(404, 409))
async def verify_driver(admin: Admin, driver_id: UidPath) -> AdminDriverDetailDTO:
    return await admin_service.verify_driver(admin, driver_id)


@router.post(
    "/drivers/{driver_id}/reject", response_model=AdminDriverDetailDTO, responses=error_responses(400, 404, 409)
)
async def reject_driver(admin: Admin, driver_id: UidPath, body: RejectBody) -> AdminDriverDetailDTO:
    return await admin_service.reject_driver(admin, driver_id, body.reason)


# ── vehicles (RC review) ──────────────────────────────────────────────────────
@router.get("/vehicles", response_model=Page[AdminVehicleRcItemDTO])
async def list_vehicles(
    admin: Admin,
    status_: Annotated[AdminListStatus, Query(alias="status")] = "pending",
    limit: Limit = 20,
    cursor: Cursor = None,
) -> Page[AdminVehicleRcItemDTO]:
    return await admin_service.list_vehicles(admin, status_, limit, cursor)


@router.post(
    "/vehicles/{vehicle_id}/rc/verify", response_model=AdminVehicleRcItemDTO, responses=error_responses(404, 409)
)
async def verify_rc(admin: Admin, vehicle_id: VehicleIdPath) -> AdminVehicleRcItemDTO:
    return await admin_service.verify_rc(admin, vehicle_id)


@router.post(
    "/vehicles/{vehicle_id}/rc/reject", response_model=AdminVehicleRcItemDTO, responses=error_responses(400, 404, 409)
)
async def reject_rc(admin: Admin, vehicle_id: VehicleIdPath, body: RejectBody) -> AdminVehicleRcItemDTO:
    return await admin_service.reject_rc(admin, vehicle_id, body.reason)


# ── settlements ───────────────────────────────────────────────────────────────
@router.get("/settlements", response_model=AdminSettlementListDTO)
async def list_settlements(_: Admin) -> AdminSettlementListDTO:
    return await admin_service.list_settlements()


@router.post(
    "/settlements",
    status_code=status.HTTP_201_CREATED,
    response_model=AdminSettlementResultDTO,
    responses=error_responses(400, 409, 501),
)
async def settle(admin: Admin, body: SettleBody) -> AdminSettlementResultDTO:
    return await admin_service.settle(admin, body.agency_id, body.through, body.reference)


@router.get("/settlements/history", response_model=Page[AdminSettlementHistoryDTO], responses=error_responses(501))
async def settlement_history(
    _: Admin,
    limit: Limit = 20,
    cursor: Cursor = None,
    agency_id: Annotated[str | None, Query(alias="agencyId", pattern=r"^agc_[a-z0-9]{20}$")] = None,
) -> Page[AdminSettlementHistoryDTO]:
    return await admin_service.settlement_history(limit, cursor, agency_id)


# ── users ─────────────────────────────────────────────────────────────────────
@router.post("/users/{uid}/disable", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(400, 404, 409))
async def disable_user(admin: Admin, uid: UidPath, body: DisableUserBody) -> Response:
    await admin_service.disable_user(admin, uid, body.reason)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/users/{uid}/enable", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404))
async def enable_user(admin: Admin, uid: UidPath) -> Response:
    await admin_service.enable_user(admin, uid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── payments ──────────────────────────────────────────────────────────────────
@router.get("/payments", response_model=Page[AdminPaymentRowDTO])
async def list_payments(
    _: Admin,
    status_: Annotated[PaymentStatus, Query(alias="status")] = "refund_failed",
    limit: Limit = 20,
    cursor: Cursor = None,
) -> Page[AdminPaymentRowDTO]:
    return await admin_service.list_payments(status_, limit, cursor)


@router.post(
    "/payments/{payment_id}/retry-refund", response_model=AdminPaymentRowDTO, responses=error_responses(404, 409, 501)
)
async def retry_refund(admin: Admin, payment_id: PaymentIdPath) -> AdminPaymentRowDTO:
    return await admin_service.retry_refund(admin, payment_id)
