"""Admin console models (contract §13; TS ``admin.ts`` + §2 deltas)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.models.enums import DriverLinkStatus, PaymentStatus, VerificationStatus
from app.schemas.common import AgencyId, CamelModel, IsoDate, PlaceDTO, Reason, UtcDateTime
from app.schemas.profile import AgencyStatsDTO, DocumentDTO, DriverStatsDTO

AdminListStatus = Literal["not_submitted", "pending", "verified", "rejected", "suspended"]


class RejectBody(CamelModel):
    reason: Reason


class SuspendBody(CamelModel):
    reason: Reason


class DisableUserBody(CamelModel):
    reason: Reason


class SettleBody(CamelModel):
    agency_id: AgencyId
    through: IsoDate
    reference: str = Field(min_length=4, max_length=40, pattern=r"^[A-Za-z0-9/_-]+$")


class EmptyBody(CamelModel):
    pass


class AdminVerificationDTO(CamelModel):
    status: VerificationStatus
    submitted_at: UtcDateTime | None = None
    reviewed_at: UtcDateTime | None = None
    reviewed_by: str | None = None
    reason: str | None = None


class AdminAgencyListItemDTO(CamelModel):
    id: str
    agency_name: str
    owner_name: str
    district_name: str
    state: str
    created_at: UtcDateTime
    verification: AdminVerificationDTO
    documents_complete: bool


class DuplicateDocumentFlag(CamelModel):
    kind: str
    other_account_type: Literal["agency", "driver"]
    other_account_id: str


class AdminAgencyDetailDTO(AdminAgencyListItemDTO):
    phone: str
    owner_uid: str
    states_covered: list[str]
    vehicle_count_range: str
    photo_url: str | None = None
    base: PlaceDTO | None = None
    documents: list[DocumentDTO]
    duplicate_document_flags: list[DuplicateDocumentFlag]
    stats: AgencyStatsDTO


class AdminDriverListItemDTO(CamelModel):
    id: str
    full_name: str
    agency_name: str | None = None
    link_status: DriverLinkStatus | None = None
    created_at: UtcDateTime
    verification: AdminVerificationDTO
    documents_complete: bool


class AdminDriverDetailDTO(AdminDriverListItemDTO):
    phone: str
    photo_url: str | None = None
    documents: list[DocumentDTO]
    license_valid_until: str | None = None
    duplicate_document_flags: list[DuplicateDocumentFlag]
    stats: DriverStatsDTO


class QueueCounts(CamelModel):
    awaiting_review: int
    awaiting_documents: int


class SettlementSummary(CamelModel):
    agencies: int
    pending_amount: int


class VehicleCounts(CamelModel):
    awaiting_rc_review: int


class PaymentCounts(CamelModel):
    refund_failed: int
    pending_over_1h: int = Field(serialization_alias="pendingOver1h")


class AdminOverviewDTO(CamelModel):
    agencies: QueueCounts
    drivers: QueueCounts
    settlements: SettlementSummary | None = None
    vehicles: VehicleCounts
    payments: PaymentCounts


class AdminSettlementRowDTO(CamelModel):
    agency_id: str
    agency_name: str
    pending_amount: int
    pending_count: int
    oldest_delivered_at: UtcDateTime


class AdminSettlementListDTO(CamelModel):
    items: list[AdminSettlementRowDTO]
    available: bool


class AdminSettlementResultDTO(CamelModel):
    settlement_id: str
    agency_id: str
    amount: int
    count: int
    reference: str
    settled_at: UtcDateTime


class AdminSettlementHistoryDTO(CamelModel):
    id: str
    agency_id: str
    agency_name: str
    amount: int
    bookings: int
    reference: str
    period_through: str
    settled_at: UtcDateTime
    recorded_by: str


class AdminVehicleRcItemDTO(CamelModel):
    vehicle_id: str
    agency_id: str
    agency_name: str
    registration_number: str
    vehicle_class: str
    rc: DocumentDTO
    rc_verification: AdminVerificationDTO
    created_at: UtcDateTime


class AdminPaymentRowDTO(CamelModel):
    id: str
    booking_id: str
    customer_id: str
    agency_id: str
    status: PaymentStatus | str
    amount_rupees: int
    failure_reason: str | None = None
    cf_order_status: str | None = None
    refund: dict[str, Any] | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class AdminBookingClosureDTO(CamelModel):
    kind: str
    reason: str | None = None


class AdminBookingStateDTO(CamelModel):
    approval_status: str
    payment_status: str
    reservation_status: str
    fulfilment_status: str
    closure: AdminBookingClosureDTO | None = None


class AdminBookingPartyDTO(CamelModel):
    id: str
    name: str
    phone_masked: str | None = None


class AdminBookingAgencyDTO(CamelModel):
    id: str
    name: str


class AdminBookingEventDTO(CamelModel):
    type: str
    at: UtcDateTime
    by_role: str | None = None
    note: str | None = None


class AdminBookingDetailDTO(CamelModel):
    """Support lookup (``GET /admin/bookings/{bookingId}``; TS ``AdminBookingDetailDTO``). Read-only;
    the customer phone is masked and OTPs, addresses and receiver details are never included."""

    id: str
    status: str
    state: AdminBookingStateDTO | None = None
    customer: AdminBookingPartyDTO | None = None
    agency: AdminBookingAgencyDTO | None = None
    trip_id: str | None = None
    route_label: str | None = None
    total_payable: int | None = None
    payments: list[AdminPaymentRowDTO]
    events: list[AdminBookingEventDTO]
    created_at: UtcDateTime
    updated_at: UtcDateTime | None = None
