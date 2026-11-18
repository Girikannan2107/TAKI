"""Payment documents (P2 §6.4 ``payments/{pay_*}``, ``webhookEvents``; §7.8). Owner: D5.

``payments/{id}``: id == the gateway order id (``pay_*``). One per checkout attempt; at most one
per booking is open (``created`` / ``pending``) at a time.

Status machine (§7.8)::

    created ─► pending ─► succeeded ─► refund_pending ─► refunded | refund_failed
       │          ├─► failed      (declined / user_dropped / gateway_error / amount_mismatch)
       └──────────┴─► cancelled   (superseded / expired / booking closed)

A late success on a failed/cancelled payment is still recorded as a success and then either
applied (booking still payable) or refunded (``late_payment`` / ``duplicate_payment``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.base import DocModel
from app.models.enums import PaymentStatus

PaymentProvider = Literal["cashfree", "dev"]
ProviderEnv = Literal["sandbox", "production", "test"]
ConfirmationSource = Literal["webhook", "verify", "reconcile", "dev_confirm"]
FailureReason = Literal[
    "declined", "user_dropped", "expired", "superseded", "amount_mismatch", "gateway_error", "booking_closed"
]
RefundReason = Literal["duplicate_payment", "late_payment", "booking_cancelled", "admin"]
RefundState = Literal["pending", "succeeded", "failed"]

OPEN_STATUSES: frozenset[str] = frozenset({"created", "pending"})
SUCCEEDED_STATUSES: frozenset[str] = frozenset({"succeeded", "refund_pending", "refunded", "refund_failed"})
TERMINAL_FAILED: frozenset[str] = frozenset({"failed", "cancelled"})


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")


class Confirmation(_Camel):
    source: ConfirmationSource
    at: datetime
    provider_status: str


class RefundInfo(_Camel):
    refund_id: str  # "rf_" + payment id suffix; sent to Cashfree as refund_id (dedupe key)
    amount_paise: int
    reason: str
    status: RefundState
    requested_at: datetime
    completed_at: datetime | None = None
    provider_refund_id: str | None = None


class PaymentAttempt(_Camel):
    provider_payment_id: str | None
    status: str
    at: datetime
    method_label: str | None = None


class PaymentDoc(DocModel):
    booking_id: str
    customer_id: str
    agency_id: str | None = None
    provider: PaymentProvider
    provider_env: ProviderEnv
    test_payment: bool = False  # True for the dev gateway: UI shows "Test payment"
    amount_paise: int
    currency: Literal["INR"] = "INR"
    status: PaymentStatus
    idempotency_key: str
    provider_order_status: str | None = None  # last seen Cashfree order_status
    payment_session_id: str | None = None
    expires_at: datetime
    provider_payment_id: str | None = None
    method_label: str | None = None  # masked ("UPI", "Credit Card ••4242")
    confirmation: Confirmation | None = None
    failure_reason: str | None = None
    refund: RefundInfo | None = None
    attempts: list[PaymentAttempt] = Field(default_factory=list)  # ≤ 20
    route_label: str | None = None  # denormalised for history lists
    paid_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    version: int = 1

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES

    @property
    def amount_rupees(self) -> int:
        return round(self.amount_paise / 100)


class WebhookEventDoc(DocModel):
    """``webhookEvents/{sha256(eventKey)}``: dedupe + audit of verified webhooks."""

    provider: Literal["cashfree"] = "cashfree"
    type: str
    event_key: str
    order_id: str | None = None
    payment_id: str | None = None
    raw_body_sha256: str
    payload: dict[str, object] = Field(default_factory=dict)  # verified JSON, customer_details stripped
    received_at: datetime
    processed_at: datetime | None = None
    outcome: Literal["applied", "duplicate", "ignored", "failed"]
    error: str | None = None
