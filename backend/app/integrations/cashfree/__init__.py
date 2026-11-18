"""Cashfree PG integration (P2 §10). Owner: D5.

Public surface:
- ``get_gateways()`` → :class:`GatewayRegistry` (``current()`` for new orders, ``for_provider()`` for refunds)
- ``verify_webhook`` / ``parse_event`` for the signed webhook
- ``check_payment_startup`` boot guard for ``main.py``'s lifespan
"""

from .errors import (
    CashfreeError,
    InvalidWebhookSignature,
    PaymentsNotConfigured,
    StaleWebhookTimestamp,
    WebhookNotConfigured,
)
from .gateway import (
    TEST_PAYMENT_LABEL,
    CashfreeGateway,
    DevGateway,
    GatewayRegistry,
    PaymentGateway,
    get_gateways,
    reset_gateways,
)
from .models import CreatedOrder, CreateOrderRequest, GatewayEvent, OrderStatus, RefundResult
from .settings import PaymentSettings, check_payment_startup, get_payment_settings
from .webhook import compute_signature, parse_event, verify_webhook

__all__ = [
    "TEST_PAYMENT_LABEL",
    "CashfreeError",
    "CashfreeGateway",
    "CreateOrderRequest",
    "CreatedOrder",
    "DevGateway",
    "GatewayEvent",
    "GatewayRegistry",
    "InvalidWebhookSignature",
    "OrderStatus",
    "PaymentGateway",
    "PaymentSettings",
    "PaymentsNotConfigured",
    "RefundResult",
    "StaleWebhookTimestamp",
    "WebhookNotConfigured",
    "check_payment_startup",
    "compute_signature",
    "get_gateways",
    "get_payment_settings",
    "parse_event",
    "reset_gateways",
    "verify_webhook",
]
