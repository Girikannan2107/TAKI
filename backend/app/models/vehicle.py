"""``vehicles/{veh_*}``, ``registrationIndex/{reg}``, ``schedules/{kind:id}`` (P2 §6.4). Owner: D3."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from app.models.agency import Camel, IdentityDocument
from app.models.base import DocModel, TimestampedDoc
from app.models.enums import BodyType, GoodsCategory, SpecialHandling, VehicleClass, VehicleModelId
from app.models.misc import VerificationState
from app.models.user import FileRef

VehicleStatus = Literal["active", "inactive", "removed"]


class Dimensions(Camel):
    length: float
    width: float
    height: float


class VehicleDoc(TimestampedDoc):
    agency_id: str
    vehicle_class: VehicleClass
    model_id: VehicleModelId | None = None
    make_model: str
    registration_number: str  # normalised "TN 37 XX 4587"
    max_payload_kg: int
    body_type: BodyType
    dimensions_ft: Dimensions | None = None
    accepted_goods: list[GoodsCategory]
    handling_supported: list[SpecialHandling] = []
    photos: list[FileRef] = []  # ≤ 5
    image_key: str
    rc: IdentityDocument | None = None  # kind "rc"
    rc_verification: VerificationState = VerificationState()
    status: VehicleStatus = "active"
    version: int = 1


class RegistrationIndexDoc(DocModel):
    vehicle_id: str
    agency_id: str
    created_at: datetime


class ScheduleDoc(DocModel):
    """``intervals: [{tripId, from, to}]`` (``from`` is a Python keyword, so intervals stay raw maps)."""

    kind: Literal["driver", "vehicle"]
    resource_id: str
    intervals: list[dict[str, Any]] = []
    updated_at: datetime
