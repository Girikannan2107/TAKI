"""Agency + driver-profile API models (contract §10, §11 E101–E103; TS ``agency.ts`` + §2 deltas). Owner: D3.

Requests validate shape only; cross-field business rules (checkpoint timing, capacity vs. vehicle,
goods vs. vehicle, rates required to publish) run in ``trip_service`` and come back as
``invalid_checkpoints`` / ``invalid_request`` with dotted ``fields`` paths.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BeforeValidator, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.domain.vehicles import REG_MESSAGE, is_valid_reg, normalize_reg
from app.models.enums import (
    BodyType,
    DriverLinkStatus,
    DriverLinkVia,
    GoodsCategory,
    SpecialHandling,
    TripStatus,
    VehicleClass,
    VehicleModelId,
    VerificationStatus,
)
from app.schemas.common import (
    AgencyId,
    CamelModel,
    FileRefDTO,
    IsoDate,
    Name,
    Phone,
    PlaceDTO,
    PlaceId,
    Reason,
    StrictCamelModel,
    UtcDateTime,
)
from app.schemas.profile import AgencyProfileDTO, DocumentDTO, DriverProfileDTO

VehicleId = Annotated[str, Field(pattern=r"^veh_[a-z0-9]{20}$")]
TripId = Annotated[str, Field(pattern=r"^trp_[a-z0-9]{20}$")]
DriverUid = Annotated[str, Field(pattern=r"^[A-Za-z0-9]{1,128}$")]


def _registration(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        raise PydanticCustomError("registration", "Enter the registration number")
    n = normalize_reg(v)
    if not is_valid_reg(n):
        raise PydanticCustomError("registration", REG_MESSAGE)
    return n


Registration = Annotated[str, BeforeValidator(_registration)]


def _make_model(v: Any) -> str:
    s = re.sub(r"\s+", " ", v.strip()) if isinstance(v, str) else ""
    if len(s) < 2:
        raise PydanticCustomError("make_model", "Enter the make and model")
    if len(s) > 60:
        raise PydanticCustomError("make_model", "Use at most 60 characters")
    return s


MakeModel = Annotated[str, BeforeValidator(_make_model)]


def _unique[T](v: list[T]) -> list[T]:
    return list(dict.fromkeys(v))


# ═══════════════════════════════ Requests ═══════════════════════════════
class DimensionsInput(CamelModel):
    length: float = Field(gt=0, le=60)
    width: float = Field(gt=0, le=12)
    height: float = Field(gt=0, le=15)


class VehicleBody(StrictCamelModel):
    vehicle_class: VehicleClass
    model_id: VehicleModelId | None = None
    make_model: MakeModel
    registration_number: Registration
    max_payload_kg: int = Field(ge=100, le=40_000)
    body_type: BodyType
    dimensions_ft: DimensionsInput | None = None
    accepted_goods: list[GoodsCategory] = Field(min_length=1)
    handling_supported: list[SpecialHandling] = Field(default_factory=list)

    _dedupe = field_validator("accepted_goods", "handling_supported")(_unique)


class VehiclePatchBody(StrictCamelModel):
    vehicle_class: VehicleClass | None = None
    model_id: VehicleModelId | None = None
    make_model: MakeModel | None = None
    registration_number: Registration | None = None
    max_payload_kg: int | None = Field(None, ge=100, le=40_000)
    body_type: BodyType | None = None
    dimensions_ft: DimensionsInput | None = None
    accepted_goods: list[GoodsCategory] | None = Field(None, min_length=1)
    handling_supported: list[SpecialHandling] | None = None
    status: Literal["active", "inactive"] | None = None


class DriverInviteBody(StrictCamelModel):
    full_name: Name("the driver's name")  # type: ignore[valid-type]
    phone: Phone


class DriverPatchBody(StrictCamelModel):
    availability: Literal["available", "unavailable"]


class DriverRejectBody(CamelModel):
    reason: str | None = Field(None, max_length=300)


class AdditionalChargeInput(StrictCamelModel):
    label: str = Field(min_length=2, max_length=40)
    amount_rupees: int = Field(ge=0, le=5000)
    basis: Literal["per_booking", "special_handling_only"] = "per_booking"

    @field_validator("label")
    @classmethod
    def _trim(cls, v: str) -> str:
        s = re.sub(r"\s+", " ", v.strip())
        if len(s) < 2:
            raise PydanticCustomError("label", "Enter a name for this charge")
        return s


class CheckpointInput(StrictCamelModel):
    place_id: PlaceId
    service_radius_km: float = Field(10, ge=2, le=15)
    expected_arrival_at: AwareDatetime | None = None
    expected_departure_at: AwareDatetime | None = None


class _TripFields(StrictCamelModel):
    max_package_kg: int | None = Field(None, gt=0, le=40_000)
    goods_notes: str | None = Field(None, max_length=300)
    rate_per_km_paise: int | None = Field(None, ge=100, le=10_000)
    rate_per_kg_paise: int | None = Field(None, ge=0, le=2_000)

    @field_validator("goods_notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        return (v.strip() or None) if isinstance(v, str) else v


class TripBody(_TripFields):
    vehicle_id: VehicleId
    driver_id: DriverUid
    offered_kg: int = Field(ge=100, le=40_000)
    checkpoints: list[CheckpointInput] = Field(min_length=2, max_length=10)
    accepted_goods: list[GoodsCategory] = Field(min_length=1)
    handling_supported: list[SpecialHandling] = Field(default_factory=list)
    additional_charges: list[AdditionalChargeInput] = Field(default_factory=list, max_length=5)
    publish: bool = False

    _dedupe = field_validator("accepted_goods", "handling_supported")(_unique)


class TripPatchBody(_TripFields):
    """All optional, no defaults; ``publish`` is not accepted (use E76)."""

    vehicle_id: VehicleId | None = None
    driver_id: DriverUid | None = None
    offered_kg: int | None = Field(None, ge=100, le=40_000)
    checkpoints: list[CheckpointInput] | None = Field(None, min_length=2, max_length=10)
    accepted_goods: list[GoodsCategory] | None = Field(None, min_length=1)
    handling_supported: list[SpecialHandling] | None = None
    additional_charges: list[AdditionalChargeInput] | None = Field(None, max_length=5)


class PreviewCheckpoint(StrictCamelModel):
    place_id: PlaceId


class TripPreviewBody(StrictCamelModel):
    checkpoints: list[PreviewCheckpoint] = Field(min_length=2, max_length=10)
    departure_at: AwareDatetime | None = None
    dwell_minutes: int = Field(15, ge=0, le=240)
    rate_per_km_paise: int = Field(0, ge=0, le=10_000)
    rate_per_kg_paise: int = Field(0, ge=0, le=2_000)
    sample_weight_kg: int = Field(500, ge=1, le=40_000)
    additional_charges: list[AdditionalChargeInput] = Field(default_factory=list, max_length=5)


class CancelTripBody(StrictCamelModel):
    reason: Reason


class ReassignBody(StrictCamelModel):
    driver_id: DriverUid | None = None
    vehicle_id: VehicleId | None = None

    @model_validator(mode="after")
    def _one(self) -> ReassignBody:
        if not self.driver_id and not self.vehicle_id:
            raise PydanticCustomError("field:driverId", "Choose a new driver or vehicle")
        return self


class AgencyLinkBody(StrictCamelModel):
    agency_id: AgencyId


class EmptyBody(CamelModel):
    pass


TripTab = Literal["upcoming", "active", "completed", "cancelled", "drafts"]
HistoryType = Literal["bookings", "trips", "vehicles", "drivers", "customers"]


# ═══════════════════════════════ Responses ═══════════════════════════════
class DimensionsDTO(CamelModel):
    length: float
    width: float
    height: float


class RcVerificationDTO(CamelModel):
    status: VerificationStatus
    reason: str | None = None
    reviewed_at: UtcDateTime | None = None


class VehicleDTO(CamelModel):
    id: str
    vehicle_class: str
    model_id: str | None = None
    make_model: str
    registration_number: str
    max_payload_kg: int
    body_type: str
    dimensions_ft: DimensionsDTO | None = None
    accepted_goods: list[str]
    handling_supported: list[str]
    photos: list[FileRefDTO]
    image_key: str
    status: Literal["active", "inactive", "removed"]
    active_trips: int = 0
    rc: DocumentDTO | None = None
    rc_verification: RcVerificationDTO
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ScheduleSlotDTO(CamelModel):
    trip_id: str
    from_: UtcDateTime = Field(serialization_alias="from", validation_alias="from")
    to: UtcDateTime


class LicenseSummaryDTO(CamelModel):
    number_masked: str | None = None
    file_url: str | None = None
    valid_until: str | None = None


class AadhaarSummaryDTO(CamelModel):
    number_masked: str | None = None
    file_url: str | None = None


class DriverLinkDTO(CamelModel):
    status: DriverLinkStatus
    via: DriverLinkVia
    requested_at: UtcDateTime | None = None
    decided_at: UtcDateTime | None = None
    reason: str | None = None


class DriverStatsDTO(CamelModel):
    rating_avg: float = 0
    rating_count: int = 0
    delivered: int = 0


class AgencyDriverDTO(CamelModel):
    id: str
    full_name: str
    phone: str  # full number: the agency may contact its own drivers
    phone_masked: str
    photo_url: str | None = None
    license: LicenseSummaryDTO
    aadhaar: AadhaarSummaryDTO
    link: DriverLinkDTO
    availability: Literal["available", "unavailable"]
    verification: VerificationStatus
    stats: DriverStatsDTO
    next_assignment: ScheduleSlotDTO | None = None


class ReviewDTO(CamelModel):
    id: str
    booking_id: str
    rating: int
    comment: str | None = None
    customer_first_name: str
    created_at: UtcDateTime


class InviteDTO(CamelModel):
    id: str
    full_name: str
    phone: str
    phone_masked: str
    status: Literal["pending", "accepted", "revoked", "expired"]
    expires_at: UtcDateTime
    created_at: UtcDateTime


class TripCheckpointDTO(CamelModel):
    index: int
    place_id: str
    place_name: str
    district: str | None = None
    district_name: str
    state: str
    lat: float
    lng: float
    service_radius_km: float
    km_from_origin: float
    expected_arrival_at: UtcDateTime | None = None
    expected_departure_at: UtcDateTime | None = None
    actual_arrival_at: UtcDateTime | None = None
    actual_departure_at: UtcDateTime | None = None


class TripLegDTO(CamelModel):
    index: int
    from_name: str
    to_name: str
    distance_km: float
    duration_min: int
    load_kg: int
    available_kg: int


class TripRouteDTO(CamelModel):
    distance_km: float
    duration_min: int
    overview_polyline: str


class TripCapacityDTO(CamelModel):
    vehicle_max_kg: int
    offered_kg: int
    booked_kg: int  # committed (paid), on the most-loaded leg
    reserved_kg: int  # held (unexpired), on the most-loaded leg
    available_kg: int  # offered − max leg load


class AdditionalChargeDTO(CamelModel):
    code: str
    label: str
    amount_rupees: int
    basis: Literal["per_booking", "special_handling_only"]


class TripRatesDTO(CamelModel):
    per_km_paise: int
    per_kg_paise: int
    additional_charges: list[AdditionalChargeDTO]


class TripCountsDTO(CamelModel):
    awaiting: int = 0
    held: int = 0
    committed: int = 0
    delivered: int = 0


class TripVehicleDTO(CamelModel):
    id: str
    registration_number: str
    vehicle_class: str
    make_model: str
    image_key: str


class TripDriverDTO(CamelModel):
    id: str
    full_name: str
    photo_url: str | None = None


class AgencyTripListItem(CamelModel):
    id: str
    status: TripStatus
    route_label: str
    stops: list[str]
    departure_at: UtcDateTime
    arrival_at: UtcDateTime
    distance_km: float
    vehicle: TripVehicleDTO
    driver: TripDriverDTO
    capacity: TripCapacityDTO
    counts: TripCountsDTO
    rates: TripRatesDTO
    departed: bool
    published_at: UtcDateTime | None = None
    updated_at: UtcDateTime


class TripGoodsDTO(CamelModel):
    accepted: list[str]
    handling_supported: list[str]
    max_package_kg: int | None = None
    notes: str | None = None


class AgencyTripDTO(AgencyTripListItem):
    checkpoints: list[TripCheckpointDTO]
    legs: list[TripLegDTO]
    route: TripRouteDTO | None = None
    searchable: bool
    goods: TripGoodsDTO
    cancel_reason: str | None = None
    cancelled_at: UtcDateTime | None = None
    started_at: UtcDateTime | None = None
    completed_at: UtcDateTime | None = None
    bookings: list[dict[str, Any]]
    publish_blockers: list[str]


class TripTabCounts(CamelModel):
    upcoming: int = 0
    active: int = 0
    completed: int = 0
    cancelled: int = 0
    drafts: int = 0


class TripListResponse(CamelModel):
    items: list[AgencyTripListItem]
    next_cursor: str | None = None
    counts: TripTabCounts


class TripFormVehicleOption(CamelModel):
    id: str
    label: str
    registration_number: str
    max_payload_kg: int
    accepted_goods: list[str]
    handling_supported: list[str]
    status: Literal["active", "inactive"]
    rc_status: str  # "missing" | VerificationStatus
    busy: ScheduleSlotDTO | None = None


class TripFormDriverOption(CamelModel):
    id: str
    full_name: str
    availability: Literal["available", "unavailable"]
    verification: VerificationStatus
    link_status: DriverLinkStatus
    busy: ScheduleSlotDTO | None = None


class TripFormOptionsDTO(CamelModel):
    vehicles: list[TripFormVehicleOption]
    drivers: list[TripFormDriverOption]
    verification: VerificationStatus


class PreviewCheckpointDTO(CamelModel):
    place_id: str
    place_name: str
    district: str | None = None
    state: str
    lat: float
    lng: float
    km_from_origin: float
    leg_distance_km: float | None = None
    leg_duration_min: int | None = None
    suggested_arrival_at: UtcDateTime | None = None
    suggested_departure_at: UtcDateTime | None = None


class EarningsPreviewDTO(CamelModel):
    distance_charge: int
    weight_charge: int
    additional_charges: int
    earnings: int


class TripPreviewDTO(CamelModel):
    checkpoints: list[PreviewCheckpointDTO]
    distance_km: float
    duration_mins: int
    overview_polyline: str
    sample_weight_kg: int
    earnings_preview: EarningsPreviewDTO


class AgencyDriverDetailDTO(AgencyDriverDTO):
    trips: list[AgencyTripListItem]
    reviews: list[ReviewDTO]
    schedule: list[ScheduleSlotDTO]


class HistoryLink(CamelModel):
    type: Literal["booking", "trip", "vehicle", "driver"]
    id: str


class HistoryRow(CamelModel):
    type: HistoryType
    id: str
    title: str
    subtitle: str
    date: UtcDateTime
    status: str | None = None
    link: HistoryLink | None = None


class HistoryPage(CamelModel):
    items: list[HistoryRow]
    next_cursor: str | None = None


class MonthAmount(CamelModel):
    month: str
    amount: int


class RevenueDTO(CamelModel):
    this_month: int
    last_month: int
    total: int
    change_pct: int | None = None
    monthly_series: list[MonthAmount]


class DashboardAgencyDTO(CamelModel):
    id: str
    name: str
    owner_name: str
    verification: VerificationStatus
    verification_reason: str | None = None


class DashboardTotals(CamelModel):
    vehicles: int
    drivers: int
    pending_drivers: int


class DashboardTrips(CamelModel):
    active: int
    upcoming: int


class AgencyDashboardDTO(CamelModel):
    agency: DashboardAgencyDTO
    totals: DashboardTotals
    trips: DashboardTrips
    pending_bookings: int
    completed_shipments: int
    revenue: RevenueDTO
    upcoming_trips: list[AgencyTripListItem]
    recent_activity: list[dict[str, Any]]


class EarningsSummaryDTO(CamelModel):
    total: int
    pending: int
    settled: int
    on_hold: int
    this_month: int
    last_month: int


class EarningsByTripDTO(CamelModel):
    trip_id: str
    route_label: str
    delivered_bookings: int
    agency_net: int
    last_delivered_at: UtcDateTime


class AgencyEarningRowDTO(CamelModel):
    booking_id: str
    trip_id: str
    route_label: str
    customer_paid: int
    transportation_charge: int
    additional_charges: int
    handling_fee: int  # DEPRECATED alias of additionalCharges (one release)
    platform_fee: int
    agency_net: int
    delivered_at: UtcDateTime
    status: Literal["pending", "settled", "on_hold"]
    settled_at: UtcDateTime | None = None


class AgencyPaymentRowDTO(CamelModel):
    id: str
    booking_id: str
    status: str
    amount_rupees: int
    method_label: str | None = None
    created_at: UtcDateTime
    paid_at: UtcDateTime | None = None


class AgencySettlementDTO(CamelModel):
    id: str
    amount: int
    bookings: int
    reference: str
    period_through: str
    settled_at: UtcDateTime


class AgencyEarningsDTO(CamelModel):
    summary: EarningsSummaryDTO
    monthly_series: list[MonthAmount]
    by_trip: list[EarningsByTripDTO]
    by_booking: list[AgencyEarningRowDTO]
    payments: list[AgencyPaymentRowDTO]
    settlements: list[AgencySettlementDTO]


class ProfileCounts(CamelModel):
    vehicles: int
    drivers: int
    pending_drivers: int


class AgencyProfileResponse(AgencyProfileDTO):
    """E48: ``AgencyProfileDTO & AgencyProfileSummaryDTO``."""

    counts: ProfileCounts


class VerificationRequirement(CamelModel):
    key: Literal["photo", "identity_document"]
    done: bool


class AgencyVerificationStatusDTO(CamelModel):
    status: VerificationStatus
    reason: str | None = None
    submitted_at: UtcDateTime | None = None
    reviewed_at: UtcDateTime | None = None
    requirements: list[VerificationRequirement]


class DriverAppProfileDTO(CamelModel):
    account: DriverProfileDTO
    reviews: list[ReviewDTO]


class EarningsQuery(CamelModel):
    from_: IsoDate | None = Field(None, alias="from")
    to: IsoDate | None = None


__all__ = [name for name in dir() if name[0].isupper()]
_ = (PlaceDTO, datetime)
