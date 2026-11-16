"""Booking documents (P2 §6.4 ``bookings``, ``bookings/{id}/events``, ``bookingSecrets``). Owner: D4.

Services work on camelCase dicts (what ``repositories/base`` returns); these ``TypedDict``s document
the stored shapes for readers and type checkers. Timestamps are native Firestore ``Timestamp``s.

State: four independent machines (``approvalStatus``, ``paymentStatus``, ``reservationStatus``,
``fulfilmentStatus``) plus ``closure``. ``status`` / ``tab`` / ``agencyTab`` / ``driverTab`` are
written only from ``domain.booking_machine.derive`` (stored for queries).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, TypedDict

from app.models.enums import (
    AgencyBookingTab,
    ApprovalStatus,
    BookingPaymentStatus,
    BookingStatus,
    CustomerTab,
    DriverShipmentTab,
    FulfilmentStatus,
    ReservationStatus,
)

TrackingEventType = Literal[
    "requested",
    "accepted",
    "rejected",
    "expired",
    "payment_started",
    "payment_succeeded",
    "payment_failed",
    "confirmed",
    "driver_assigned",
    "driver_reassigned",
    "cancelled",
    "picked_up",
    "in_transit",
    "checkpoint_arrived",
    "checkpoint_departed",
    "out_for_delivery",
    "delivered",
    "delivery_proof_added",
    "refund_started",
    "refunded",
    "remark",
]
Visibility = Literal["customer", "agency", "driver"]


class Actor(TypedDict):
    role: Literal["customer", "agency", "driver", "admin", "system"]
    userId: str | None


class Closure(TypedDict):
    kind: Literal["rejected", "cancelled"]
    reason: str  # agency_rejected | no_response_before_departure | trip_cancelled | customer_cancelled | …
    note: str | None
    at: datetime
    by: Actor


class SegmentEnd(TypedDict, total=False):
    checkpointIndex: int
    placeName: str
    district: str
    placeId: str
    expectedDepartureAt: datetime  # pickup
    expectedArrivalAt: datetime  # drop
    distanceKm: float  # address → checkpoint (straight line at request time)


class BookingDoc(TypedDict, total=False):
    id: str  # TAKI########
    shipmentId: str
    tripId: str
    customerId: str
    agencyId: str
    driverId: str
    vehicleId: str
    approvalStatus: ApprovalStatus
    paymentStatus: BookingPaymentStatus
    reservationStatus: ReservationStatus
    fulfilmentStatus: FulfilmentStatus
    closure: Closure | None
    status: BookingStatus
    tab: CustomerTab
    agencyTab: AgencyBookingTab
    driverTab: DriverShipmentTab | None
    matchType: Literal["exact", "intermediate"]
    pickup: SegmentEnd
    drop: SegmentEnd
    weightKg: int
    goodsCategory: str
    specialHandling: list[str]
    pricing: dict[str, Any]  # PricingBreakdown v3 (domain/pricing.quote)
    respondBy: datetime
    acceptedAt: datetime | None
    paymentDueAt: datetime | None
    paidAt: datetime | None
    paymentId: str | None
    driverAssignedAt: datetime | None
    pickedUpAt: datetime | None
    deliveredAt: datetime | None
    statusHistory: list[dict[str, Any]]
    reviewed: bool
    display: dict[
        str, Any
    ]  # customerName, customerPhone, receiverName, agencyName, routeLabel, tripDepartureAt, vehicleReg, driverName
    searchTokens: list[str]
    createdAt: datetime
    updatedAt: datetime
    version: int


class BookingEventDoc(TypedDict, total=False):
    id: str  # bev_*
    bookingId: str
    type: TrackingEventType
    at: datetime
    seq: int
    clientAt: datetime | None
    actor: Actor
    checkpointIndex: int | None
    placeName: str | None
    remarks: str | None
    files: list[dict[str, str]]  # [{fileId}]
    visibility: list[Visibility]


class BookingSecretsDoc(TypedDict, total=False):
    id: str
    pickupOtpEnc: str  # Fernet(OTP_ENC_KEY) ciphertext
    deliveryOtpEnc: str
    pickupAttempts: int
    deliveryAttempts: int
    pickupUsedAt: datetime | None
    deliveryUsedAt: datetime | None
    issuedAt: datetime
    updatedAt: datetime
