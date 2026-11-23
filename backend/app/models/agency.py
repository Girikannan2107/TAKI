"""``agencies/{agc_*}`` (P2 §6.4). Owner: D3. Services read/write camelCase dicts; this model documents
and validates the shape (``AgencyDoc.model_validate(doc)``)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.models.base import TimestampedDoc
from app.models.misc import VerificationState
from app.models.user import FileRef


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")


class GeoPoint(Camel):
    lat: float
    lng: float


class PlaceRef(Camel):
    """A geocoded place (agency base, checkpoint, address), P2 §6.2."""

    place_id: str
    name: str
    formatted_address: str = ""
    location: GeoPoint
    locality: str | None = None
    district: str | None = None
    state: str | None = None
    state_name: str | None = None
    pincode: str | None = None
    geohash: str | None = None
    geocoded_at: datetime | None = None


class IdentityDocument(Camel):
    kind: Literal["aadhaar", "pan", "driving_license", "rc"]
    number_masked: str | None = None
    number_hmac: str | None = None
    file: FileRef
    back_file: FileRef | None = None
    valid_until: date | str | None = None
    uploaded_at: datetime


class AgencyStats(Camel):
    vehicles: int = 0
    drivers: int = 0
    rating_avg: float = 0
    rating_count: int = 0
    delivered: int = 0


class AgencyDoc(TimestampedDoc):
    owner_uid: str
    owner_name: str
    agency_name: str
    name_lower: str
    search_tokens: list[str] = []
    base: PlaceRef | None = None
    states_covered: list[str] = []
    vehicle_count_range: str = "1-5"
    phone: str
    photo: FileRef | None = None
    identity_document: IdentityDocument | None = None
    verification: VerificationState = VerificationState()
    stats: AgencyStats = AgencyStats()
    version: int = 1


def verification_status(doc: dict[str, Any] | None, field: str = "verification") -> str:
    """``verification.status`` of an agency/driver (or ``rcVerification`` of a vehicle) dict."""
    return str(((doc or {}).get(field) or {}).get("status", "not_submitted"))
