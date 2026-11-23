"""Profile, documents and photo models (contract §4.1, TS ``auth.ts`` profile DTOs + §2 deltas)."""

from __future__ import annotations

from typing import Literal

from app.models.enums import (
    DocumentStatus,
    DriverLinkStatus,
    DriverLinkVia,
    IdentityDocumentKind,
    VehicleCountRange,
    VerificationStatus,
)
from app.schemas.common import (
    CamelModel,
    FileRefDTO,
    Name,
    PlaceDTO,
    PlaceInput,
    StatesCovered,
    StrictCamelModel,
    UtcDateTime,
)


# ── Requests ──────────────────────────────────────────────────────────────────
class CustomerProfilePatch(StrictCamelModel):
    full_name: Name("your full name")  # type: ignore[valid-type]


class AgencyProfilePatch(StrictCamelModel):
    owner_name: Name("the owner's name")  # type: ignore[valid-type]
    agency_name: Name("the agency name", 80)  # type: ignore[valid-type]
    base: PlaceInput
    states_covered: StatesCovered
    vehicle_count_range: VehicleCountRange


class DriverProfilePatch(StrictCamelModel):
    full_name: Name("your full name", 80)  # type: ignore[valid-type]


# ── Responses ─────────────────────────────────────────────────────────────────
class DocumentDTO(CamelModel):
    kind: str
    label: str
    number_masked: str | None = None
    file_url: str | None = None
    back_file_url: str | None = None
    status: DocumentStatus
    uploaded_at: UtcDateTime | None = None
    valid_until: str | None = None


class DocumentUploadResultDTO(CamelModel):
    document: DocumentDTO
    verification: VerificationStatus


class PhotoResultDTO(CamelModel):
    photo_url: str
    file: FileRefDTO


class _ProfileBase(CamelModel):
    id: str
    phone: str
    phone_masked: str
    photo_url: str | None = None
    created_at: UtcDateTime


class CustomerProfileDTO(_ProfileBase):
    role: Literal["customer"] = "customer"
    full_name: str
    dob: str


class AgencyVerificationDTO(CamelModel):
    status: VerificationStatus
    submitted_at: UtcDateTime | None = None
    reviewed_at: UtcDateTime | None = None
    reason: str | None = None


class AgencyStatsDTO(CamelModel):
    vehicles: int = 0
    drivers: int = 0
    rating_avg: float = 0
    rating_count: int = 0
    delivered: int = 0


class AgencyProfileDTO(_ProfileBase):
    role: Literal["agency"] = "agency"
    agency_id: str
    owner_name: str
    agency_name: str
    base: PlaceDTO | None = None
    district_name: str
    state: str
    states_covered: list[str]
    vehicle_count_range: str
    verification: AgencyVerificationDTO
    documents: list[DocumentDTO]
    stats: AgencyStatsDTO


class DriverAgencyLinkDTO(CamelModel):
    agency_id: str
    agency_name: str
    status: DriverLinkStatus
    via: DriverLinkVia


class DriverVerificationDTO(CamelModel):
    status: VerificationStatus
    reviewed_at: UtcDateTime | None = None
    reason: str | None = None


class DriverStatsDTO(CamelModel):
    rating_avg: float = 0
    rating_count: int = 0
    delivered: int = 0


class DriverProfileDTO(_ProfileBase):
    role: Literal["driver"] = "driver"
    full_name: str
    agency_link: DriverAgencyLinkDTO | None = None
    verification: DriverVerificationDTO
    documents: list[DocumentDTO]
    stats: DriverStatsDTO


class AdminProfileDTO(_ProfileBase):
    role: Literal["admin"] = "admin"
    name: str


ProfileDTO = CustomerProfileDTO | AgencyProfileDTO | DriverProfileDTO | AdminProfileDTO

DocumentKindPath = IdentityDocumentKind
