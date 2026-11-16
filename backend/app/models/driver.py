"""``drivers/{uid}`` and ``driverInvites/{inv_*}`` (P2 §6.4). Owner: D3."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.models.agency import Camel, IdentityDocument
from app.models.base import DocModel, TimestampedDoc
from app.models.enums import DriverLinkStatus, DriverLinkVia
from app.models.misc import VerificationState
from app.models.user import FileRef

Availability = Literal["available", "unavailable"]
InviteStatus = Literal["pending", "accepted", "revoked", "expired"]
INVITE_TTL_DAYS = 14


class DriverAgencyLink(Camel):
    agency_id: str
    agency_name: str
    status: DriverLinkStatus
    via: DriverLinkVia
    requested_at: datetime
    decided_at: datetime | None = None
    reason: str | None = None


class DriverStats(Camel):
    rating_avg: float = 0
    rating_count: int = 0
    delivered: int = 0


class DriverDoc(TimestampedDoc):
    full_name: str
    phone: str
    photo: FileRef | None = None
    license: IdentityDocument | None = None
    aadhaar: IdentityDocument | None = None
    agency_link: DriverAgencyLink | None = None
    availability: Availability = "available"
    verification: VerificationState = VerificationState()
    stats: DriverStats = DriverStats()
    version: int = 1


class DriverInviteDoc(DocModel):
    agency_id: str
    agency_name: str
    phone: str
    full_name: str
    status: InviteStatus = "pending"
    expires_at: datetime
    driver_id: str | None = None
    created_at: datetime
    updated_at: datetime
