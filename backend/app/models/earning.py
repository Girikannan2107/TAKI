"""``earnings/{bookingId}`` and ``settlements/{stl_*}`` (P2 §6.4). Owner: D3.

Earnings are created by D4's ``deliver`` transaction (one per delivered booking, ``pending``);
admins record settlements (E123), which mark earnings ``settled``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.models.base import DocModel

EarningStatus = Literal["pending", "settled", "on_hold"]


class EarningDoc(DocModel):
    booking_id: str
    agency_id: str
    trip_id: str
    driver_id: str | None = None
    customer_paid: int
    transportation_charge: int
    additional_charges: int = 0
    platform_fee: int
    agency_net: int  # transportation + additional
    route_label: str
    delivered_at: datetime
    status: EarningStatus = "pending"
    settlement_id: str | None = None
    settled_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SettlementDoc(DocModel):
    agency_id: str
    amount: int
    earning_ids: list[str]
    reference: str  # bank UTR
    period_through: str  # IST date
    settled_at: datetime
    recorded_by: str
    created_at: datetime
