"""Customer request / response schemas (contract §8). Owner: D4.

Request bodies validate strictly. Response models document the main fields; nested structures are
built by ``views/customer.py`` and kept as-is (``extra="allow"``), so the JSON shape is exactly the
view's output.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

from app.models.enums import GoodsCategory, PackageType, SpecialHandling, StateCode, VehicleClass
from app.schemas.common import CamelModel, IsoDate, Name, Phone, Pincode, PlaceId

ShipmentId = Annotated[str, Field(pattern=r"^shp_[a-z0-9]{20}$")]
TripId = Annotated[str, Field(pattern=r"^trp_[a-z0-9]{20}$")]
BookingId = Annotated[str, Field(pattern=r"^TAKI\d{8}$")]


def _trim_opt(max_len: int) -> Any:
    def f(v: Any) -> Any:
        if v is None:
            return None
        if not isinstance(v, str):
            raise PydanticCustomError("text", "Enter text")
        s = v.strip()
        if not s:
            return None
        if len(s) > max_len:
            raise PydanticCustomError("text", f"Use at most {max_len} characters")
        return s

    return BeforeValidator(f)


class LatLng(CamelModel):
    lat: float = Field(ge=6.0, le=37.6)
    lng: float = Field(ge=68.0, le=97.5)


class AddressInput(CamelModel):
    line1: Annotated[str, Field(min_length=3, max_length=120)]
    line2: Annotated[str | None, _trim_opt(120)] = None
    landmark: Annotated[str | None, _trim_opt(80)] = None
    pincode: Pincode
    state: StateCode
    source: Literal["autocomplete", "current_location", "manual"]
    place_id: PlaceId | None = None
    location: LatLng | None = None

    @model_validator(mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        if isinstance(v, dict) and isinstance(v.get("line1"), str):
            v = {**v, "line1": v["line1"].strip()}
        return v

    @model_validator(mode="after")
    def _source_fields(self) -> AddressInput:
        if self.source == "autocomplete" and not self.place_id:
            raise PydanticCustomError("field:placeId", "Choose an address from the suggestions")
        if self.source == "current_location" and self.location is None:
            raise PydanticCustomError("field:location", "Allow location access or enter the address")
        if self.source == "autocomplete" and self.location is not None:
            raise PydanticCustomError("field:location", "Send either a place or a location")
        if self.source == "current_location" and self.place_id:
            raise PydanticCustomError("field:placeId", "Send either a place or a location")
        if self.source == "manual" and (self.place_id or self.location is not None):
            raise PydanticCustomError("field:source", "Manual addresses are geocoded on the server")
        return self


def _declaration(v: Any) -> Literal[True]:
    if v is not True:
        raise PydanticCustomError("declaration", "Confirm that the shipment has no prohibited items")
    return True


class ShipmentPackageInput(CamelModel):
    weight_kg: int = Field(ge=10, le=25_000)
    goods_category: GoodsCategory
    package_type: PackageType
    description: Annotated[str, Field(min_length=3, max_length=300)]
    pieces: int = Field(1, ge=1, le=500)
    special_handling: list[SpecialHandling] = Field(default_factory=list, max_length=4)
    declared_value_rupees: int | None = Field(None, ge=0, le=10_000_000)
    prohibited_items_declaration: Annotated[bool, BeforeValidator(_declaration)]

    @model_validator(mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        if isinstance(v, dict) and isinstance(v.get("description"), str):
            v = {**v, "description": v["description"].strip()}
        return v


class Receiver(CamelModel):
    name: Name("the receiver's name", 60)  # type: ignore[valid-type]
    phone: Phone


class CreateShipmentBody(CamelModel):
    source: AddressInput
    destination: AddressInput
    receiver: Receiver
    package: ShipmentPackageInput
    shipping_date: IsoDate

    def to_service(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class RequestBookingBody(CamelModel):
    shipment_id: ShipmentId
    trip_id: TripId


class CancelBookingBody(CamelModel):
    reason: Annotated[str | None, _trim_opt(300)] = None


class ReviewBody(CamelModel):
    rating: int = Field(ge=1, le=5)
    comment: Annotated[str | None, _trim_opt(500)] = None


class RegenerateOtpBody(CamelModel):
    which: Literal["pickup", "delivery"]


class RejectBookingBody(CamelModel):
    reason: Annotated[str, Field(min_length=3, max_length=300)]

    @model_validator(mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        if isinstance(v, dict) and isinstance(v.get("reason"), str):
            v = {**v, "reason": v["reason"].strip()}
        return v


# ── responses (documented; nested parts kept as built by the views) ───────────
class OpenModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")


class ShipmentDTO(OpenModel):
    id: str
    status: str
    source: dict[str, Any]
    destination: dict[str, Any]
    receiver: dict[str, Any]
    package: dict[str, Any]
    shipping_date: str
    current_booking_id: str | None
    editable: bool
    direct_distance_km: float
    created_at: str
    updated_at: str


class CustomerBookingListItem(OpenModel):
    id: str
    status: str
    tab: str
    state: dict[str, Any]
    shipment_id: str


class ShipmentListItem(ShipmentDTO):
    current_booking: dict[str, Any] | None = None


class ShipmentWithBookingsDTO(ShipmentDTO):
    bookings: list[dict[str, Any]]


class ShipmentPage(OpenModel):
    items: list[ShipmentListItem]
    next_cursor: str | None = None


class TripOfferDTO(OpenModel):
    trip_id: str
    match_type: Literal["exact", "intermediate"]
    distance_source: Literal["road", "straight_line"]
    pricing: dict[str, Any]


class OffersResponse(OpenModel):
    items: list[TripOfferDTO]
    excluded_for_capacity: int
    excluded_for_restrictions: int
    date: str


class TripDetailsDTO(TripOfferDTO):
    reviews: list[dict[str, Any]]
    problem: str | None
    existing_booking_id: str | None
    route_polyline: str


class CustomerBookingDTO(OpenModel):
    id: str
    status: str
    tab: str
    state: dict[str, Any]
    shipment: dict[str, Any]
    trip: dict[str, Any]
    pricing: dict[str, Any]
    otps: dict[str, Any] | None = None


class BookingPage(OpenModel):
    items: list[CustomerBookingListItem]
    next_cursor: str | None = None


class OtpsResponse(OpenModel):
    otps: dict[str, Any] | None


class TrackingDTO(OpenModel):
    booking_id: str
    status: str
    stages: list[dict[str, Any]]
    events: list[dict[str, Any]]
    live_location: None = None


class ReviewDTO(OpenModel):
    id: str
    booking_id: str
    rating: int
    comment: str | None
    customer_first_name: str
    created_at: str


class ReviewPage(OpenModel):
    items: list[ReviewDTO]
    next_cursor: str | None = None


class CustomerDashboardDTO(OpenModel):
    first_name: str
    counts: dict[str, int]
    active: list[dict[str, Any]]
    open_shipments: list[dict[str, Any]]
    recent_activity: list[dict[str, Any]]


class AgencyBookingListItem(OpenModel):
    id: str
    status: str
    tab: str
    state: dict[str, Any]
    trip_id: str


class AgencyBookingDTO(AgencyBookingListItem):
    customer: dict[str, Any]
    timeline: list[dict[str, Any]]


class AgencyBookingListResponse(OpenModel):
    items: list[AgencyBookingListItem]
    next_cursor: str | None = None
    counts: dict[str, int]


__all__ = [
    "AddressInput",
    "AgencyBookingDTO",
    "AgencyBookingListItem",
    "AgencyBookingListResponse",
    "BookingId",
    "BookingPage",
    "CancelBookingBody",
    "CreateShipmentBody",
    "CustomerBookingDTO",
    "CustomerBookingListItem",
    "CustomerDashboardDTO",
    "OffersResponse",
    "OpenModel",
    "OtpsResponse",
    "RegenerateOtpBody",
    "RejectBookingBody",
    "RequestBookingBody",
    "ReviewBody",
    "ReviewDTO",
    "ReviewPage",
    "ShipmentDTO",
    "ShipmentId",
    "ShipmentListItem",
    "ShipmentPage",
    "ShipmentWithBookingsDTO",
    "TrackingDTO",
    "TripDetailsDTO",
    "TripId",
    "TripOfferDTO",
    "VehicleClass",
]
