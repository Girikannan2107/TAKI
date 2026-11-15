"""Every status / enum value (P2 §7, contract §0.2). Owner: D2 (others ask D2 to add values).

Values are the wire strings; ``Literal`` aliases are used in Pydantic models and ``tuple``
constants for validation and meta responses.
"""

from __future__ import annotations

from typing import Literal, get_args

Role = Literal["customer", "agency", "driver", "admin"]
PublicRole = Literal["customer", "agency", "driver"]
UserStatus = Literal["active", "disabled"]
StateCode = Literal["TN", "KL", "KA", "TG", "AP"]

VerificationStatus = Literal["not_submitted", "pending", "verified", "rejected", "suspended"]
DriverLinkStatus = Literal["pending", "active", "rejected", "removed"]
DriverLinkVia = Literal["invite", "request"]
DocumentKind = Literal["aadhaar", "pan", "driving_license", "rc"]
IdentityDocumentKind = Literal["aadhaar", "pan", "driving_license"]
DocumentStatus = Literal["missing", "pending", "verified", "rejected"]

FileOwnerType = Literal["customer", "agency", "driver", "vehicle", "booking"]
FileKind = Literal["profile_photo", "aadhaar", "pan", "driving_license", "rc", "vehicle_photo", "delivery_proof"]
FileContentType = Literal["image/jpeg", "image/png", "image/webp", "application/pdf"]
FileStatus = Literal["active", "replaced", "deleted"]

GoodsCategory = Literal[
    "general_goods",
    "agriculture",
    "construction",
    "industrial",
    "electronics",
    "furniture",
    "textiles",
    "perishables",
    "other",
]
PackageType = Literal["box", "bag", "sack", "crate", "pallet", "loose", "other"]
SpecialHandling = Literal["fragile", "keep_dry", "this_side_up", "temperature_sensitive"]
VehicleClass = Literal["Mini Truck", "Pickup", "Light Truck", "Medium Truck", "Heavy Truck"]
BodyType = Literal["open", "tarpaulin", "closed", "container"]
VehicleCountRange = Literal["1-5", "6-10", "11-25", "26-50", "50+"]
VehicleModelId = Literal["tata_ace", "mahindra_bolero_pickup", "tata_407", "eicher_pro", "ashok_leyland_ecomet"]

BookingStatus = Literal[
    "awaiting_agency",
    "pending_payment",
    "payment_failed",
    "confirmed",
    "picked_up",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "rejected",
    "cancelled",
]
CustomerTab = Literal["pending", "confirmed", "picked_up", "in_transit", "delivered", "rejected", "cancelled"]
AgencyBookingTab = Literal["pending", "accepted", "confirmed", "rejected", "cancelled"]
DriverShipmentTab = Literal["pending_pickup", "in_transit", "delivered"]
ApprovalStatus = Literal["pending", "accepted", "rejected", "expired", "withdrawn"]
BookingPaymentStatus = Literal[
    "not_due",
    "due",
    "processing",
    "paid",
    "failed",
    "expired",
    "voided",
    "refund_pending",
    "refunded",
    "refund_failed",
]
ReservationStatus = Literal["none", "held", "committed", "released", "consumed"]
FulfilmentStatus = Literal["not_started", "picked_up", "in_transit", "out_for_delivery", "delivered", "pickup_refused"]
PaymentStatus = Literal[
    "created", "pending", "succeeded", "failed", "cancelled", "refund_pending", "refunded", "refund_failed"
]
TripStatus = Literal["draft", "published", "in_progress", "completed", "cancelled"]
ContactRole = Literal["customer", "agency", "driver", "other"]


def values(lit: object) -> tuple[str, ...]:
    return tuple(get_args(lit))


ROLES = values(Role)
STATE_CODES = values(StateCode)
VERIFICATION_STATUSES = values(VerificationStatus)
GOODS_CATEGORIES = values(GoodsCategory)
PACKAGE_TYPES = values(PackageType)
SPECIAL_HANDLING = values(SpecialHandling)
VEHICLE_CLASSES = values(VehicleClass)
BODY_TYPES = values(BodyType)
VEHICLE_COUNT_RANGES = values(VehicleCountRange)
PAYMENT_STATUSES = values(PaymentStatus)
