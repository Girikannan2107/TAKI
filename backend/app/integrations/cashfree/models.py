"""Cashfree PG wire models (API version 2025-01-01) and the provider-neutral results (D5).

Only the fields TAKI reads are declared; everything else is ignored. Amounts on the wire are
rupees with up to two decimals; inside TAKI they are integer paise.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


def to_paise(rupees: Any) -> int | None:
    """``123.45`` / ``"123.45"`` → ``12345``. ``None`` or garbage → ``None``."""
    if rupees is None or isinstance(rupees, bool):
        return None
    try:
        return int((Decimal(str(rupees)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except ArithmeticError:
        return None


def paise_to_rupees_wire(paise: int) -> float:
    """``12345`` → ``123.45`` (the JSON number Cashfree expects)."""
    return float(Decimal(paise) / 100)


class _Wire(BaseModel):
    model_config = ConfigDict(extra="ignore")


class CfOrder(_Wire):
    order_id: str
    cf_order_id: str | int | None = None
    order_status: str  # ACTIVE | PAID | EXPIRED | TERMINATED | TERMINATION_REQUESTED
    order_amount: float | None = None
    order_currency: str | None = None
    payment_session_id: str | None = None
    order_expiry_time: str | None = None
    order_tags: dict[str, Any] | None = None


class CfPayment(_Wire):
    cf_payment_id: str | int | None = None
    order_id: str | None = None
    payment_status: str  # SUCCESS | FAILED | PENDING | USER_DROPPED | CANCELLED | VOID | NOT_ATTEMPTED
    payment_amount: float | None = None
    payment_currency: str | None = None
    payment_time: str | None = None
    payment_completion_time: str | None = None
    payment_group: str | None = None
    payment_method: dict[str, Any] | None = None
    payment_message: str | None = None


class CfRefund(_Wire):
    refund_id: str
    cf_refund_id: str | int | None = None
    order_id: str | None = None
    refund_amount: float | None = None
    refund_status: str  # SUCCESS | PENDING | CANCELLED | ONHOLD


# ── Provider-neutral results (used by payment_service; also produced by the dev gateway) ──

OrderOutcome = Literal["paid", "failed", "pending", "expired"]
RefundOutcome = Literal["pending", "succeeded", "failed"]


@dataclass(frozen=True, slots=True)
class OrderStatus:
    """What the gateway says about an order right now (the only input that can confirm a payment)."""

    status: OrderOutcome
    amount_paise: int | None
    provider_payment_id: str | None
    method_label: str | None
    provider_status: str  # raw, e.g. "PAID", "ACTIVE:USER_DROPPED", "EXPIRED"
    failure_reason: Literal["declined", "user_dropped", "expired"] | None = None


@dataclass(frozen=True, slots=True)
class RefundResult:
    status: RefundOutcome
    provider_refund_id: str | None
    provider_status: str


@dataclass(frozen=True, slots=True)
class CreateOrderRequest:
    order_id: str  # == payment id (pay_*)
    amount_paise: int
    customer_id: str
    customer_phone: str  # E.164 or 10 digits; sent as 10 digits
    customer_name: str
    return_url: str
    notify_url: str
    expires_at_iso: str  # ISO-8601 with offset (+05:30)
    tags: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class CreatedOrder:
    checkout: dict[str, Any]  # CheckoutPayload (camelCase, sent to the browser as is)
    payment_session_id: str | None
    provider_order_status: str


@dataclass(frozen=True, slots=True)
class GatewayEvent:
    """A verified, parsed Cashfree webhook."""

    kind: Literal["payment_succeeded", "payment_failed", "payment_dropped", "refund_status"]
    type: str  # raw Cashfree type, e.g. PAYMENT_SUCCESS_WEBHOOK
    order_id: str
    event_key: str  # f"{type}:{order_id}:{cf_payment_id|refund_id}:{status}"
    provider_payment_id: str | None = None
    amount_paise: int | None = None
    method_label: str | None = None
    provider_status: str = ""
    refund_id: str | None = None
    refund_status: RefundOutcome | None = None
    provider_refund_id: str | None = None


def method_label_of(p: CfPayment) -> str | None:
    """Masked method label: payment group plus at most the last 4 card digits (never the full PAN/VPA)."""
    if not p.payment_group:
        return None
    group = (
        p.payment_group.replace("_", " ").upper()
        if p.payment_group.lower() == "upi"
        else p.payment_group.replace("_", " ").title()
    )
    card_last4 = ""
    if p.payment_method:
        inner = next(iter(p.payment_method.values()), None)
        if isinstance(inner, dict):
            number = inner.get("card_number")
            if isinstance(number, str):
                digits = "".join(ch for ch in number if ch.isdigit())
                card_last4 = digits[-4:]
    return f"{group} ••{card_last4}" if card_last4 else group


def refund_outcome(cf_status: str) -> RefundOutcome:
    if cf_status == "SUCCESS":
        return "succeeded"
    if cf_status == "CANCELLED":
        return "failed"
    return "pending"  # PENDING, ONHOLD, unknown


def ten_digit_phone(phone: str) -> str:
    """``+919876543210`` → ``9876543210`` (Cashfree customer_phone)."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    return digits[-10:]
