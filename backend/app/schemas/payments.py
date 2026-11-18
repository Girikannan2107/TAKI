"""Payment API models (contract §9, E42–E46 + the dev-only test gateway). Owner: D5."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.models.enums import BookingStatus, PaymentStatus
from app.schemas.common import CamelModel, UtcDateTime

BookingIdField = Field(pattern=r"^TAKI\d{8}$")
PaymentIdPattern = r"^pay_[a-z0-9]{20}$"


class CreatePaymentOrderBody(CamelModel):
    booking_id: str = BookingIdField


class CashfreeCheckout(CamelModel):
    kind: Literal["cashfree"] = "cashfree"
    mode: Literal["sandbox", "production"]
    payment_session_id: str
    order_id: str


class DevCheckout(CamelModel):
    """Local/e2e only (``PAYMENT_PROVIDER=dev``): the UI must show ``label`` ("Test payment")."""

    kind: Literal["dev"] = "dev"
    mode: Literal["test"] = "test"
    label: str
    order_id: str
    dev_token: str
    url: str


class CreatePaymentOrderResponse(CamelModel):
    payment_id: str
    provider: Literal["cashfree", "dev"]
    amount_rupees: int
    expires_at: UtcDateTime
    checkout: CashfreeCheckout | DevCheckout
    reused: bool
    test_payment: bool = False


class RefundDTO(CamelModel):
    status: Literal["pending", "succeeded", "failed"]
    amount_rupees: int
    completed_at: UtcDateTime | None = None


class BookingStateDTO(CamelModel):
    approval_status: str
    payment_status: str
    reservation_status: str
    fulfilment_status: str
    closure: dict[str, Any] | None = None


class PaymentStatusResponse(CamelModel):
    payment_id: str
    booking_id: str
    status: PaymentStatus
    booking_status: BookingStatus | str
    booking_state: BookingStateDTO | None
    amount_rupees: int
    provider: Literal["cashfree", "dev"]
    method_label: str | None
    failure_reason: str | None
    refund: RefundDTO | None
    test_payment: bool = False


class PaymentHistoryItem(CamelModel):
    id: str
    booking_id: str
    status: PaymentStatus
    provider: Literal["cashfree", "dev"]
    amount_rupees: int
    method_label: str | None
    created_at: UtcDateTime
    paid_at: UtcDateTime | None
    refund: RefundDTO | None
    route_label: str | None
    test_payment: bool = False


class PaymentHistoryPage(CamelModel):
    items: list[PaymentHistoryItem]
    next_cursor: str | None = None


class WebhookAck(CamelModel):
    ok: bool = True
    outcome: Literal["applied", "duplicate", "ignored"]


class DevConfirmBody(CamelModel):
    payment_id: str = Field(pattern=PaymentIdPattern)
    outcome: Literal["success", "failure"]
    dev_token: str = Field(min_length=16, max_length=128)
