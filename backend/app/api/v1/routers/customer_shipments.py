"""E26–E30: customer shipments. Owner: D4."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query, Response

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.deps import require_role
from app.models.enums import CustomerTab
from app.schemas.customer import CreateShipmentBody, ShipmentDTO, ShipmentPage, ShipmentWithBookingsDTO
from app.schemas.errors import error_responses
from app.services import shipment_service

router = APIRouter(prefix="/customer/shipments", tags=["customer"])

CustomerDep = Annotated[CurrentUser, Depends(require_role("customer"))]
ClockDep = Annotated[Clock, Depends(get_clock)]
ShipmentIdPath = Annotated[str, Path(pattern=r"^shp_[a-z0-9]{20}$")]


@router.post("", status_code=201, response_model=ShipmentDTO, responses=error_responses(401, 403, 422, 502, 503))
async def create_shipment(body: CreateShipmentBody, user: CustomerDep, clock: ClockDep) -> dict[str, Any]:
    return await shipment_service.create(user, body.to_service(), now=clock.now())


@router.get("", response_model=ShipmentPage, responses=error_responses(401, 403))
async def list_shipments(
    user: CustomerDep,
    tab: CustomerTab | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> dict[str, Any]:
    return await shipment_service.list_page(user, tab=tab, limit=limit, cursor=cursor)


@router.get("/{shipment_id}", response_model=ShipmentWithBookingsDTO, responses=error_responses(401, 403, 404))
async def get_shipment(shipment_id: ShipmentIdPath, user: CustomerDep) -> dict[str, Any]:
    return await shipment_service.detail(user, shipment_id)


@router.patch(
    "/{shipment_id}", response_model=ShipmentDTO, responses=error_responses(401, 403, 404, 409, 422, 502, 503)
)
async def update_shipment(
    shipment_id: ShipmentIdPath, body: CreateShipmentBody, user: CustomerDep, clock: ClockDep
) -> dict[str, Any]:
    return await shipment_service.update(user, shipment_id, body.to_service(), now=clock.now())


@router.delete("/{shipment_id}", status_code=204, responses=error_responses(401, 403, 404, 409))
async def withdraw_shipment(shipment_id: ShipmentIdPath, user: CustomerDep, clock: ClockDep) -> Response:
    await shipment_service.withdraw(user, shipment_id, now=clock.now())
    return Response(status_code=204)
