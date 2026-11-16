"""``trips/{trp_*}`` and ``trips/{id}/events/{tev_*}`` (P2 §6.4, §7.5, §8.1). Owner: D3."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from app.models.agency import Camel, PlaceRef
from app.models.base import DocModel, TimestampedDoc
from app.models.enums import GoodsCategory, SpecialHandling, TripStatus
from app.models.user import FileRef

TripEventType = Literal[
    "published",
    "unpublished",
    "started",
    "checkpoint_arrived",
    "checkpoint_departed",
    "completed",
    "cancelled",
    "driver_reassigned",
]
ChargeBasis = Literal["per_booking", "special_handling_only"]
HoldState = Literal["held", "committed"]

OPEN_TRIP_STATUSES = ("draft", "published", "in_progress")
LIVE_TRIP_STATUSES = ("published", "in_progress")


class TripCheckpoint(Camel):
    index: int
    place: PlaceRef
    service_radius_km: float = 10
    km_from_origin: float = 0
    expected_arrival_at: datetime | None = None
    expected_departure_at: datetime | None = None
    actual_arrival_at: datetime | None = None
    actual_departure_at: datetime | None = None


class TripLeg(Camel):
    index: int
    distance_km: float
    duration_min: int
    polyline: str


class TripRoute(Camel):
    distance_km: float
    duration_min: int
    overview_polyline: str
    computed_at: datetime
    source: str = "google_routes"


class CapacityHold(Camel):
    kg: int
    from_index: int
    to_index: int
    state: HoldState
    due_at: datetime | None = None


class AdditionalCharge(Camel):
    code: str
    label: str
    amount_rupees: int
    basis: ChargeBasis = "per_booking"


class TripVehicleSnap(Camel):
    vehicle_class: str
    make_model: str
    registration_number: str
    body_type: str
    photo: FileRef | None = None
    image_key: str


class TripDriverSnap(Camel):
    full_name: str
    photo: FileRef | None = None
    rating_avg: float = 0
    rating_count: int = 0


class TripCapacity(Camel):
    vehicle_max_kg: int
    offered_kg: int


class CapacitySummary(Camel):
    committed_kg_max_leg: int = 0
    held_kg_max_leg: int = 0
    max_leg_load_kg: int = 0


class TripGoods(Camel):
    accepted: list[GoodsCategory]
    handling_supported: list[SpecialHandling] = []
    max_package_kg: int | None = None
    notes: str | None = None


class TripRates(Camel):
    per_km_paise: int
    per_kg_paise: int


class TripCounts(Camel):
    awaiting: int = 0
    held: int = 0
    committed: int = 0
    delivered: int = 0


class TripProgress(Camel):
    last_checkpoint_index: int | None = None
    last_event_at: datetime | None = None
    next_step: dict[str, Any] | None = None


class TripDoc(TimestampedDoc):
    agency_id: str
    agency_name: str
    vehicle_id: str
    vehicle: TripVehicleSnap
    driver_id: str
    driver: TripDriverSnap
    status: TripStatus = "draft"
    checkpoints: list[TripCheckpoint]
    legs: list[TripLeg] = []
    route: TripRoute | None = None
    departure_at: datetime
    arrival_at: datetime
    capacity: TripCapacity
    holds: dict[str, CapacityHold] = {}
    capacity_summary: CapacitySummary = CapacitySummary()
    goods: TripGoods
    rates: TripRates
    additional_charges: list[AdditionalCharge] = []
    search_keys: list[str] = []
    progress: TripProgress = TripProgress()
    counts: TripCounts = TripCounts()
    published_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    version: int = 1


class Actor(Camel):
    role: Literal["customer", "agency", "driver", "admin", "system"]
    user_id: str | None = None


class TripEventDoc(DocModel):
    trip_id: str
    type: TripEventType
    checkpoint_index: int | None = None
    at: datetime
    client_at: datetime | None = None
    actor: Actor
    remarks: str | None = None
