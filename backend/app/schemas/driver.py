"""Driver app request / response schemas (contract §11). Owner: D4.

No location fields are accepted on any driver endpoint: positions are never collected or fabricated.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BeforeValidator, Field
from pydantic_core import PydanticCustomError

from app.schemas.common import CamelModel
from app.schemas.customer import OpenModel


def _remarks(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise PydanticCustomError("remarks", "Enter text")
    s = v.strip()
    if len(s) > 300:
        raise PydanticCustomError("remarks", "Keep remarks under 300 characters")
    return s or None


def _client_at(v: Any) -> Any:
    if v is None or v == "":
        return None
    if isinstance(v, str) and not (v.endswith("Z") or "+" in v[10:] or "-" in v[10:]):
        raise PydanticCustomError("datetime", "Include a time zone offset")
    return v


Remarks = Annotated[str | None, BeforeValidator(_remarks)]
ClientAt = Annotated[datetime | None, BeforeValidator(_client_at)]
OtpCode = Annotated[str, Field(pattern=r"^\d{6}$")]


class CheckpointActionBody(CamelModel):
    remarks: Remarks = None
    client_at: ClientAt = None


class PickupBody(CamelModel):
    otp: OtpCode
    remarks: Remarks = None
    client_at: ClientAt = None


class RefusePickupBody(CamelModel):
    reason: Annotated[
        str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v), Field(min_length=5, max_length=300)
    ]


class RemarkBody(CamelModel):
    text: Annotated[
        str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v), Field(min_length=1, max_length=300)
    ]


DriverShipmentTab = Literal["pending_pickup", "in_transit", "delivered"]
DriverTripFilter = Literal["upcoming", "active", "completed"]


class DriverShipmentDTO(OpenModel):
    booking_id: str
    trip_id: str
    status: str
    state: dict[str, Any]
    customer: dict[str, Any]
    receiver: dict[str, Any]
    allowed_actions: list[str]


class DriverShipmentListItem(OpenModel):
    booking_id: str
    trip_id: str
    status: str
    state: dict[str, Any]


class DriverShipmentPage(OpenModel):
    items: list[DriverShipmentListItem]
    next_cursor: str | None = None


class DriverHistoryDTO(OpenModel):
    items: list[dict[str, Any]]
    next_cursor: str | None = None


class DriverEventDTO(OpenModel):
    id: str
    type: str
    at: str
    by_role: str


class DriverTripListItem(OpenModel):
    id: str
    status: str
    route_label: str
    next_step: dict[str, Any] | None = None


class DriverTripList(OpenModel):
    items: list[DriverTripListItem]


class DriverTripDTO(DriverTripListItem):
    checkpoints: list[dict[str, Any]]
    events: list[dict[str, Any]]
    can_complete: bool
    route_polyline: str


class DriverDashboardDTO(OpenModel):
    driver: dict[str, Any]
    agency: dict[str, Any] | None
    approved: bool
    active_trips: int
    pending_pickups: int
    in_transit: int
    completed_deliveries: int


__all__ = [
    "CheckpointActionBody",
    "DriverDashboardDTO",
    "DriverEventDTO",
    "DriverHistoryDTO",
    "DriverShipmentDTO",
    "DriverShipmentListItem",
    "DriverShipmentPage",
    "DriverShipmentTab",
    "DriverTripDTO",
    "DriverTripFilter",
    "DriverTripList",
    "DriverTripListItem",
    "OtpCode",
    "PickupBody",
    "RefusePickupBody",
    "RemarkBody",
]
