"""E31–E33: offers for a saved shipment, guest search, trip details. Owner: D4."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path, Query

from app.core.clock import Clock, get_clock
from app.core.context import CurrentUser
from app.core.errors import AppError
from app.deps import get_optional_user, require_role
from app.middleware.rate_limit import client_ip, rate_limit
from app.models.enums import GOODS_CATEGORIES, SPECIAL_HANDLING, VEHICLE_CLASSES, GoodsCategory
from app.schemas.common import IsoDate
from app.schemas.customer import OffersResponse, TripDetailsDTO
from app.schemas.errors import error_responses
from app.services import search_service

router = APIRouter(tags=["customer"])

CustomerDep = Annotated[CurrentUser, Depends(require_role("customer"))]
OptionalUser = Annotated[CurrentUser | None, Depends(get_optional_user)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Sort = Literal["price_asc", "price_desc", "departure_asc", "arrival_asc"]
PLACE_RE = r"^[A-Za-z0-9_-]{10,300}$"


def _split(values: list[str] | None, allowed: tuple[str, ...], field: str) -> list[str] | None:
    """Repeated or comma-separated query values."""
    if not values:
        return None
    out: list[str] = []
    for v in values:
        out += [x.strip() for x in v.split(",") if x.strip()]
    bad = [x for x in out if x not in allowed]
    if bad:
        raise AppError("invalid_request", fields={field: f"Unknown value {bad[0]!r}"})
    return list(dict.fromkeys(out)) or None


def _filters(
    sort: Sort,
    vehicle_class: list[str] | None,
    min_price: int | None,
    max_price: int | None,
    min_capacity_kg: int | None,
    date: str | None,
) -> dict[str, Any]:
    return {
        "sort": sort,
        "vehicleClass": _split(vehicle_class, VEHICLE_CLASSES, "vehicleClass"),
        "minPrice": min_price,
        "maxPrice": max_price,
        "minCapacityKg": min_capacity_kg,
        "date": date,
    }


def _valid_date(v: str | None) -> str | None:
    if v is None:
        return None
    from pydantic import TypeAdapter, ValidationError

    try:
        return str(TypeAdapter(IsoDate).validate_python(v))
    except ValidationError as e:
        raise AppError("invalid_request", fields={"date": "Enter a valid date (YYYY-MM-DD)"}) from e


@router.get(
    "/customer/shipments/{shipment_id}/offers",
    response_model=OffersResponse,
    responses=error_responses(401, 403, 404, 409),
)
async def shipment_offers(
    shipment_id: Annotated[str, Path(pattern=r"^shp_[a-z0-9]{20}$")],
    user: CustomerDep,
    clock: ClockDep,
    sort: Sort = "price_asc",
    vehicle_class: Annotated[list[str] | None, Query(alias="vehicleClass")] = None,
    min_price: Annotated[int | None, Query(alias="minPrice", ge=0)] = None,
    max_price: Annotated[int | None, Query(alias="maxPrice", gt=0)] = None,
    min_capacity_kg: Annotated[int | None, Query(alias="minCapacityKg", gt=0)] = None,
    date: str | None = None,
) -> dict[str, Any]:
    f = _filters(sort, vehicle_class, min_price, max_price, min_capacity_kg, _valid_date(date))
    return await search_service.offers_for_shipment(user, shipment_id, f, now=clock.now())


@router.get(
    "/customer/search",
    response_model=OffersResponse,
    responses=error_responses(400, 422, 429, 502, 503),
    dependencies=[Depends(rate_limit("search_ip", client_ip))],
)
async def guest_search(
    clock: ClockDep,
    viewer: OptionalUser,
    from_place_id: Annotated[str, Query(alias="fromPlaceId", pattern=PLACE_RE)],
    to_place_id: Annotated[str, Query(alias="toPlaceId", pattern=PLACE_RE)],
    weight_kg: Annotated[int, Query(alias="weightKg", ge=10, le=25_000)],
    date: str,
    goods: GoodsCategory = "general_goods",
    handling: Annotated[list[str] | None, Query()] = None,
    sort: Sort = "price_asc",
    vehicle_class: Annotated[list[str] | None, Query(alias="vehicleClass")] = None,
    min_price: Annotated[int | None, Query(alias="minPrice", ge=0)] = None,
    max_price: Annotated[int | None, Query(alias="maxPrice", gt=0)] = None,
    min_capacity_kg: Annotated[int | None, Query(alias="minCapacityKg", gt=0)] = None,
) -> dict[str, Any]:
    q = _filters(sort, vehicle_class, min_price, max_price, min_capacity_kg, _valid_date(date))
    q.update(
        {
            "fromPlaceId": from_place_id,
            "toPlaceId": to_place_id,
            "weightKg": weight_kg,
            "goods": goods,
            "handling": _split(handling, SPECIAL_HANDLING, "handling"),
        }
    )
    return await search_service.guest_search(q, now=clock.now(), viewer=viewer)


@router.get(
    "/customer/trips/{trip_id}",
    response_model=TripDetailsDTO,
    responses=error_responses(400, 401, 404, 422, 429),
    dependencies=[Depends(rate_limit("search_ip", client_ip))],  # P2 §5.8: search:ip covers trip detail
)
async def trip_details(
    trip_id: Annotated[str, Path(pattern=r"^trp_[a-z0-9]{20}$")],
    clock: ClockDep,
    viewer: OptionalUser,
    shipment_id: Annotated[str | None, Query(alias="shipmentId", pattern=r"^shp_[a-z0-9]{20}$")] = None,
    from_place_id: Annotated[str | None, Query(alias="fromPlaceId", pattern=PLACE_RE)] = None,
    to_place_id: Annotated[str | None, Query(alias="toPlaceId", pattern=PLACE_RE)] = None,
    weight_kg: Annotated[int | None, Query(alias="weightKg", ge=10, le=25_000)] = None,
    goods: GoodsCategory | None = None,
    handling: Annotated[list[str] | None, Query()] = None,
) -> dict[str, Any]:
    if goods is not None and goods not in GOODS_CATEGORIES:
        raise AppError("invalid_request", fields={"goods": "Unknown goods category"})
    q = {
        "shipmentId": shipment_id,
        "fromPlaceId": from_place_id,
        "toPlaceId": to_place_id,
        "weightKg": weight_kg,
        "goods": goods,
        "handling": _split(handling, SPECIAL_HANDLING, "handling"),
    }
    return await search_service.trip_details(trip_id, q, now=clock.now(), viewer=viewer)
