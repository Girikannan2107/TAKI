"""Admin projections (contract §13). Admin can read every file, so URLs are signed for the admin."""

from __future__ import annotations

from typing import Any

from app.domain import booking_machine as bm
from app.domain.phone import format_phone_for_admin, mask_phone
from app.schemas.admin import (
    AdminAgencyDetailDTO,
    AdminAgencyListItemDTO,
    AdminBookingAgencyDTO,
    AdminBookingClosureDTO,
    AdminBookingDetailDTO,
    AdminBookingEventDTO,
    AdminBookingPartyDTO,
    AdminBookingStateDTO,
    AdminDriverDetailDTO,
    AdminDriverListItemDTO,
    AdminPaymentRowDTO,
    AdminVehicleRcItemDTO,
    AdminVerificationDTO,
    DuplicateDocumentFlag,
)
from app.schemas.common import district_name_of, place_dto
from app.schemas.profile import AgencyStatsDTO, DriverStatsDTO
from app.views.common import (
    agency_documents,
    agency_documents_complete,
    document_dto,
    driver_documents,
    driver_documents_complete,
    ref_url,
)


def verification_dto(v: dict[str, Any] | None) -> AdminVerificationDTO:
    v = v or {}
    return AdminVerificationDTO(
        status=v.get("status", "not_submitted"),
        submitted_at=v.get("submittedAt"),
        reviewed_at=v.get("reviewedAt"),
        reviewed_by=v.get("reviewedBy"),
        reason=v.get("reason"),
    )


def agency_item(a: dict[str, Any]) -> AdminAgencyListItemDTO:
    return AdminAgencyListItemDTO(
        id=a["id"],
        agency_name=a.get("agencyName", ""),
        owner_name=a.get("ownerName", ""),
        district_name=district_name_of(a.get("base")),
        state=str((a.get("base") or {}).get("state", "")),
        created_at=a["createdAt"],
        verification=verification_dto(a.get("verification")),
        documents_complete=agency_documents_complete(a),
    )


def agency_detail(a: dict[str, Any], admin_uid: str, flags: list[DuplicateDocumentFlag]) -> AdminAgencyDetailDTO:
    return AdminAgencyDetailDTO(
        **agency_item(a).model_dump(),
        phone=format_phone_for_admin(a.get("phone", "")),
        owner_uid=a.get("ownerUid", ""),
        states_covered=list(a.get("statesCovered") or []),
        vehicle_count_range=a.get("vehicleCountRange", ""),
        photo_url=ref_url(a.get("photo"), admin_uid),
        base=place_dto(a.get("base")),
        documents=agency_documents(a, admin_uid),
        duplicate_document_flags=flags,
        stats=AgencyStatsDTO.model_validate(a.get("stats") or {}),
    )


def driver_item(d: dict[str, Any]) -> AdminDriverListItemDTO:
    link = d.get("agencyLink") or {}
    return AdminDriverListItemDTO(
        id=d["id"],
        full_name=d.get("fullName", ""),
        agency_name=link.get("agencyName"),
        link_status=link.get("status"),
        created_at=d["createdAt"],
        verification=verification_dto(d.get("verification")),
        documents_complete=driver_documents_complete(d),
    )


def driver_detail(d: dict[str, Any], admin_uid: str, flags: list[DuplicateDocumentFlag]) -> AdminDriverDetailDTO:
    lic = d.get("license") or {}
    return AdminDriverDetailDTO(
        **driver_item(d).model_dump(),
        phone=format_phone_for_admin(d.get("phone", "")),
        photo_url=ref_url(d.get("photo"), admin_uid),
        documents=driver_documents(d, admin_uid),
        license_valid_until=lic.get("validUntil"),
        duplicate_document_flags=flags,
        stats=DriverStatsDTO.model_validate(d.get("stats") or {}),
    )


def vehicle_rc_item(v: dict[str, Any], admin_uid: str) -> AdminVehicleRcItemDTO:
    rcv = v.get("rcVerification") or {}
    return AdminVehicleRcItemDTO(
        vehicle_id=v["id"],
        agency_id=v.get("agencyId", ""),
        agency_name=v.get("agencyName", ""),
        registration_number=v.get("registrationNumber", ""),
        vehicle_class=v.get("vehicleClass", ""),
        rc=document_dto("rc", v.get("rc"), rcv, admin_uid),
        rc_verification=verification_dto(rcv),
        created_at=v["createdAt"],
    )


def payment_row(p: dict[str, Any]) -> AdminPaymentRowDTO:
    refund = p.get("refund")
    return AdminPaymentRowDTO(
        id=p["id"],
        booking_id=p.get("bookingId", ""),
        customer_id=p.get("customerId", ""),
        agency_id=p.get("agencyId", ""),
        status=p.get("status", ""),
        amount_rupees=round(int(p.get("amountPaise", 0)) / 100),
        failure_reason=p.get("failureReason"),
        cf_order_status=p.get("cfOrderStatus"),
        refund=(
            {
                "status": refund.get("status"),
                "amountRupees": round(int(refund.get("amountPaise", 0)) / 100),
                "reason": refund.get("reason"),
            }
            if refund
            else None
        ),
        created_at=p["createdAt"],
        updated_at=p.get("updatedAt", p["createdAt"]),
    )


def booking_detail(
    b: dict[str, Any],
    customer: dict[str, Any] | None,
    payments: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> AdminBookingDetailDTO:
    """Admin support view of one booking. Contact data is masked (phone ``+91 ••••• •3210``);
    OTPs, addresses and receiver details are never projected."""
    display = b.get("display") or {}
    closure = b.get("closure")
    customer_id = b.get("customerId")
    customer_phone = (customer or {}).get("phone") or display.get("customerPhone")
    agency_id = b.get("agencyId")
    return AdminBookingDetailDTO(
        id=b["id"],
        status=bm.derive(b)["status"],
        state=AdminBookingStateDTO(
            approval_status=str(b.get("approvalStatus", "")),
            payment_status=str(b.get("paymentStatus", "")),
            reservation_status=str(b.get("reservationStatus", "")),
            fulfilment_status=str(b.get("fulfilmentStatus", "")),
            closure=AdminBookingClosureDTO(kind=str(closure.get("kind", "")), reason=closure.get("reason"))
            if closure
            else None,
        ),
        customer=AdminBookingPartyDTO(
            id=customer_id,
            name=(customer or {}).get("fullName") or display.get("customerName") or "",
            phone_masked=mask_phone(customer_phone) if customer_phone else None,
        )
        if customer_id
        else None,
        agency=AdminBookingAgencyDTO(id=agency_id, name=display.get("agencyName") or "") if agency_id else None,
        trip_id=b.get("tripId"),
        route_label=display.get("routeLabel"),
        total_payable=(b.get("pricing") or {}).get("totalPayable"),
        payments=[payment_row(p) for p in payments],
        events=[
            AdminBookingEventDTO(
                type=str(e.get("type", "")),
                at=e["at"],
                by_role=(e.get("actor") or {}).get("role"),
                note=e.get("remarks"),
            )
            for e in events
            if e.get("at") is not None
        ],
        created_at=b["createdAt"],
        updated_at=b.get("updatedAt"),
    )
