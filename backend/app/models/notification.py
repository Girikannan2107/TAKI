"""In-app notifications (P2 §6.4 ``notifications/{ntf_*}``, §13.2). Owner: D4. No SMS or push in v3."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict

NotificationKind = Literal[
    "booking_requested",
    "booking_accepted",
    "booking_rejected",
    "booking_expired",
    "booking_cancelled",
    "payment_succeeded",
    "payment_failed",
    "payment_refunded",
    "refund_completed",
    "shipment_assigned",
    "pickup_confirmed",
    "checkpoint_reached",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "review_received",
    "trip_cancelled",
    "trip_published",
    "driver_reassigned",
    "agency_verified",
    "agency_rejected",
    "agency_suspended",
    "driver_verified",
    "driver_rejected",
    "driver_link_requested",
    "driver_link_decided",
    "driver_invited",
    "vehicle_rc_verified",
    "vehicle_rc_rejected",
    "settlement_recorded",
    "password_changed",
]
LinkType = Literal["booking", "trip", "driver", "profile", "earnings", "vehicle", "agency"]


class NotificationLink(TypedDict):
    type: str
    id: str


class NotificationDoc(TypedDict):
    id: str
    userId: str
    role: str
    kind: str
    title: str
    body: str
    link: NotificationLink | None
    createdAt: datetime
    readAt: datetime | None
