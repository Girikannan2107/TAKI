"""Cashfree webhook verification and parsing (P2 §10.4). Owner: D5.

Signature: ``base64(HMAC_SHA256(CASHFREE_SECRET_KEY, x-webhook-timestamp + raw_body))`` compared in
constant time against ``x-webhook-signature``. The raw body must be the exact bytes received.
Timestamp: seconds or milliseconds since the epoch, within ``tolerance_seconds`` of now.

A verified webhook is only a *trigger*: payment events are re-checked against ``GET /orders/{id}``
before anything is confirmed (``payment_service.handle_cashfree_webhook``).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from .errors import InvalidWebhookSignature, StaleWebhookTimestamp
from .models import CfPayment, GatewayEvent, method_label_of, refund_outcome, to_paise

_TS_RE = re.compile(r"^\d{10,13}$")

PAYMENT_EVENT_KINDS = {
    "PAYMENT_SUCCESS_WEBHOOK": "payment_succeeded",
    "PAYMENT_FAILED_WEBHOOK": "payment_failed",
    "PAYMENT_USER_DROPPED_WEBHOOK": "payment_dropped",
}
REFUND_EVENT_TYPE = "REFUND_STATUS_WEBHOOK"


def compute_signature(secret: str, timestamp: str, raw_body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), timestamp.encode("utf-8") + raw_body, hashlib.sha256)
    return base64.b64encode(mac.digest()).decode("ascii")


def verify_signature(secret: str, timestamp: str | None, raw_body: bytes, signature: str | None) -> bool:
    if not secret or not timestamp or not signature:
        return False
    expected = hmac.new(secret.encode("utf-8"), timestamp.encode("utf-8") + raw_body, hashlib.sha256).digest()
    try:
        received = base64.b64decode(signature.strip(), validate=True)
    except (binascii.Error, ValueError):
        return False
    return hmac.compare_digest(received, expected)


def is_fresh_timestamp(timestamp: str | None, now: datetime, tolerance_seconds: int = 300) -> bool:
    if not timestamp or not _TS_RE.match(timestamp.strip()):
        return False
    n = int(timestamp.strip())
    ms = n * 1000 if n < 1_000_000_000_000 else n
    return abs(now.timestamp() * 1000 - ms) <= tolerance_seconds * 1000


def verify_webhook(
    *, secret: str, headers: Mapping[str, str], raw_body: bytes, now: datetime, tolerance_seconds: int = 300
) -> None:
    """Raise 401 ``invalid_signature`` / ``stale_timestamp``; return quietly when the webhook is authentic."""
    timestamp = headers.get("x-webhook-timestamp")
    signature = headers.get("x-webhook-signature")
    if not verify_signature(secret, timestamp, raw_body, signature):
        raise InvalidWebhookSignature()
    if not is_fresh_timestamp(timestamp, now, tolerance_seconds):
        raise StaleWebhookTimestamp()


def event_type_of(raw_body: bytes) -> str:
    try:
        body = json.loads(raw_body)
    except ValueError:
        return ""
    return str(body.get("type", "")) if isinstance(body, dict) else ""


def parse_event(raw_body: bytes) -> GatewayEvent | None:
    """Parse a *verified* body. Unknown / malformed events → ``None`` (acknowledged and ignored)."""
    try:
        body = json.loads(raw_body)
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    type_ = str(body.get("type", ""))
    data: dict[str, Any] = body.get("data") or {}
    if not isinstance(data, dict):
        return None
    order: dict[str, Any] = data.get("order") or {}

    if type_ == REFUND_EVENT_TYPE:
        refund = data.get("refund") or {}
        refund_id = refund.get("refund_id")
        order_id = refund.get("order_id") or order.get("order_id")
        status = str(refund.get("refund_status", ""))
        if not refund_id or not order_id:
            return None
        return GatewayEvent(
            kind="refund_status",
            type=type_,
            order_id=str(order_id),
            event_key=f"{type_}:{order_id}:{refund_id}:{status}",
            refund_id=str(refund_id),
            refund_status=refund_outcome(status),
            provider_refund_id=str(refund["cf_refund_id"]) if refund.get("cf_refund_id") is not None else None,
            provider_status=status,
        )

    kind = PAYMENT_EVENT_KINDS.get(type_)
    payment_raw = data.get("payment")
    order_id = order.get("order_id")
    if kind is None or not order_id or not isinstance(payment_raw, dict):
        return None
    payment = CfPayment.model_validate(payment_raw)
    cf_payment_id = str(payment.cf_payment_id) if payment.cf_payment_id is not None else ""
    return GatewayEvent(
        kind=kind,  # type: ignore[arg-type]
        type=type_,
        order_id=str(order_id),
        event_key=f"{type_}:{order_id}:{cf_payment_id}:{payment.payment_status}",
        provider_payment_id=cf_payment_id or None,
        amount_paise=to_paise(
            payment.payment_amount if payment.payment_amount is not None else order.get("order_amount")
        ),
        method_label=method_label_of(payment),
        provider_status=payment.payment_status,
    )


def redact_payload(raw_body: bytes) -> dict[str, Any]:
    """The verified JSON without ``customer_details`` (stored in ``webhookEvents`` for audit)."""
    try:
        body = json.loads(raw_body)
    except ValueError:
        return {}
    if not isinstance(body, dict):
        return {}
    data = body.get("data")
    if isinstance(data, dict):
        data = {k: v for k, v in data.items() if k != "customer_details"}
        body = {**body, "data": data}
    return body
