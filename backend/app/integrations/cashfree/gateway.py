"""Payment gateways behind one interface (P2 §10). Owner: D5.

- :class:`CashfreeGateway`: the only gateway in staging and production.
- :class:`DevGateway`: owner decision, kept for local development and e2e only. It is reachable
  only when ``PAYMENT_PROVIDER=dev`` **and** ``APP_ENV`` is local/development/test. Nothing in it
  auto-succeeds: the browser lands on the "Test payment (no money moves)" page and an explicit
  Approve / Decline call (``POST /payments/dev/confirm``, with a per-payment token) feeds the result
  into the same ``payment_service.confirm_payment`` path that Cashfree uses.

``GatewayRegistry.current()`` picks the gateway for *new* orders; ``for_provider(provider)`` returns
the gateway an existing payment belongs to (refunds go back to where the money came from).
"""

from __future__ import annotations

import hashlib
import hmac
from collections.abc import Sequence
from typing import Literal, Protocol
from urllib.parse import quote

from .client import CashfreeClient, HttpCashfreeClient
from .errors import CashfreeError, PaymentsNotConfigured
from .models import (
    CfPayment,
    CreatedOrder,
    CreateOrderRequest,
    OrderStatus,
    RefundResult,
    method_label_of,
    refund_outcome,
    to_paise,
)
from .settings import PaymentSettings, get_payment_settings

Provider = Literal["cashfree", "dev"]
TEST_PAYMENT_LABEL = "Test payment"


class PaymentGateway(Protocol):
    provider: Provider
    env: str  # "sandbox" | "production" | "test"

    async def create_order(self, req: CreateOrderRequest, *, request_id: str | None = None) -> CreatedOrder: ...
    async def fetch_order_status(self, order_id: str, *, request_id: str | None = None) -> OrderStatus: ...
    async def refund(
        self, order_id: str, *, refund_id: str, amount_paise: int, reason: str, request_id: str | None = None
    ) -> RefundResult: ...
    async def fetch_refund_status(
        self, order_id: str, refund_id: str, *, request_id: str | None = None
    ) -> RefundResult | None: ...
    def checkout_for(self, order_id: str, payment_session_id: str | None) -> dict[str, object]: ...


# ── Cashfree ─────────────────────────────────────────────────────────────────────────────────


class CashfreeGateway:
    provider: Provider = "cashfree"

    def __init__(self, client: CashfreeClient, env: Literal["sandbox", "production"]) -> None:
        self.client = client
        self.env = env

    def checkout_for(self, order_id: str, payment_session_id: str | None) -> dict[str, object]:
        return {"kind": "cashfree", "mode": self.env, "paymentSessionId": payment_session_id or "", "orderId": order_id}

    async def create_order(self, req: CreateOrderRequest, *, request_id: str | None = None) -> CreatedOrder:
        try:
            order = await self.client.create_order(req, request_id=request_id)
        except CashfreeError as exc:
            if not exc.is_conflict:
                raise
            # A retried create: the order already exists at Cashfree, so continue with it (P2 §10.2).
            order = await self.client.get_order(req.order_id, request_id=request_id)
        if not order.payment_session_id or order.order_status not in ("ACTIVE", "PAID"):
            raise CashfreeError(cf_code=f"unexpected_order_status:{order.order_status}")
        return CreatedOrder(
            checkout=self.checkout_for(req.order_id, order.payment_session_id),
            payment_session_id=order.payment_session_id,
            provider_order_status=order.order_status,
        )

    async def fetch_order_status(self, order_id: str, *, request_id: str | None = None) -> OrderStatus:
        order = await self.client.get_order(order_id, request_id=request_id)
        order_paise = to_paise(order.order_amount)
        if order.order_status == "PAID":
            payments = await self.client.get_order_payments(order_id, request_id=request_id)
            ok = next((p for p in payments if p.payment_status == "SUCCESS"), None)
            if ok is None:  # PAID without a SUCCESS payment listed yet: never confirm on a guess
                return OrderStatus("pending", order_paise, None, None, "PAID:NO_SUCCESS_PAYMENT")
            return OrderStatus(
                status="paid",
                amount_paise=to_paise(ok.payment_amount),
                provider_payment_id=str(ok.cf_payment_id) if ok.cf_payment_id is not None else None,
                method_label=method_label_of(ok),
                provider_status="PAID",
            )
        if order.order_status in ("EXPIRED", "TERMINATED"):
            return OrderStatus("expired", order_paise, None, None, order.order_status, failure_reason="expired")
        if order.order_status == "ACTIVE":
            last = _latest(await self.client.get_order_payments(order_id, request_id=request_id))
            if last is not None and last.payment_status in ("FAILED", "USER_DROPPED", "CANCELLED"):
                return OrderStatus(
                    status="failed",
                    amount_paise=order_paise,
                    provider_payment_id=str(last.cf_payment_id) if last.cf_payment_id is not None else None,
                    method_label=method_label_of(last),
                    provider_status=f"ACTIVE:{last.payment_status}",
                    failure_reason="user_dropped" if last.payment_status == "USER_DROPPED" else "declined",
                )
        return OrderStatus("pending", order_paise, None, None, order.order_status)

    async def refund(
        self, order_id: str, *, refund_id: str, amount_paise: int, reason: str, request_id: str | None = None
    ) -> RefundResult:
        try:
            r = await self.client.create_refund(
                order_id, refund_id=refund_id, amount_paise=amount_paise, note=reason, request_id=request_id
            )
        except CashfreeError as exc:
            if not exc.is_conflict:
                raise
            # Same refund_id already exists: Cashfree deduplicates, read its status instead.
            r = await self.client.get_refund(order_id, refund_id, request_id=request_id)
        cf_id = str(r.cf_refund_id) if r.cf_refund_id is not None else None
        return RefundResult(refund_outcome(r.refund_status), cf_id, r.refund_status)

    async def fetch_refund_status(
        self, order_id: str, refund_id: str, *, request_id: str | None = None
    ) -> RefundResult | None:
        try:
            r = await self.client.get_refund(order_id, refund_id, request_id=request_id)
        except CashfreeError as exc:
            if exc.is_not_found:
                return None  # never created
            raise
        cf_id = str(r.cf_refund_id) if r.cf_refund_id is not None else None
        return RefundResult(refund_outcome(r.refund_status), cf_id, r.refund_status)


def _latest(payments: Sequence[CfPayment]) -> CfPayment | None:
    if not payments:
        return None
    return max(payments, key=lambda p: (p.payment_time or "", str(p.cf_payment_id or "")))


# ── Dev (local / e2e only) ───────────────────────────────────────────────────────────────────


class DevGateway:
    """TEST payments: no money moves; every checkout is labelled ``Test payment``."""

    provider: Provider = "dev"
    env = "test"

    def __init__(self, secret: str) -> None:
        self._key = hmac.new(secret.encode(), b"taki-dev-payments-v1", hashlib.sha256).digest()

    def token_for(self, payment_id: str) -> str:
        return hmac.new(self._key, payment_id.encode(), hashlib.sha256).hexdigest()[:40]

    def token_matches(self, payment_id: str, token: str) -> bool:
        return hmac.compare_digest(self.token_for(payment_id), token or "")

    def checkout_for(self, order_id: str, payment_session_id: str | None) -> dict[str, object]:
        token = self.token_for(order_id)
        return {
            "kind": "dev",
            "mode": "test",
            "label": TEST_PAYMENT_LABEL,
            "orderId": order_id,
            "devToken": token,
            "url": f"/customer/payment/dev-gateway?paymentId={quote(order_id)}&token={quote(token)}",
        }

    async def create_order(self, req: CreateOrderRequest, *, request_id: str | None = None) -> CreatedOrder:
        return CreatedOrder(
            checkout=self.checkout_for(req.order_id, None), payment_session_id=None, provider_order_status="DEV_ACTIVE"
        )

    async def fetch_order_status(self, order_id: str, *, request_id: str | None = None) -> OrderStatus:
        # The dev gateway keeps no state: only the explicit Approve/Decline call reports an outcome.
        return OrderStatus("pending", None, None, None, "DEV_ACTIVE")

    async def refund(
        self, order_id: str, *, refund_id: str, amount_paise: int, reason: str, request_id: str | None = None
    ) -> RefundResult:
        return RefundResult("succeeded", f"devrf_{refund_id}", "DEV_REFUNDED")

    async def fetch_refund_status(
        self, order_id: str, refund_id: str, *, request_id: str | None = None
    ) -> RefundResult | None:
        return None


# ── Selection ────────────────────────────────────────────────────────────────────────────────


def build_cashfree_gateway(settings: PaymentSettings) -> CashfreeGateway | None:
    app_id, secret, env = settings.CASHFREE_APP_ID, settings.CASHFREE_SECRET_KEY, settings.CASHFREE_ENV
    if not (app_id and secret and env):
        return None
    client = HttpCashfreeClient(
        app_id=app_id.get_secret_value(),
        secret_key=secret.get_secret_value(),
        base_url=settings.cashfree_base_url,
        api_version=settings.CASHFREE_API_VERSION,
        timeout_seconds=settings.CASHFREE_TIMEOUT_SECONDS,
    )
    return CashfreeGateway(client, env)


def build_dev_gateway(settings: PaymentSettings) -> DevGateway | None:
    if not settings.dev_gateway_enabled:
        return None
    secret = settings.DEV_PAYMENT_SECRET or settings.FILE_URL_SECRET
    return DevGateway(secret.get_secret_value() if secret else "taki-local-dev-payments")


class GatewayRegistry:
    """Resolves gateways from settings. Tests construct it with explicit gateways."""

    def __init__(
        self,
        settings: PaymentSettings,
        *,
        cashfree: CashfreeGateway | None = None,
        dev: DevGateway | None = None,
    ) -> None:
        self.settings = settings
        self._cashfree = cashfree if cashfree is not None else build_cashfree_gateway(settings)
        # The dev gateway exists only when the guard allows it, even if a test passes one in.
        self._dev = (dev or build_dev_gateway(settings)) if settings.dev_gateway_enabled else None

    @property
    def configured(self) -> bool:
        return self._active() is not None

    @property
    def provider(self) -> Provider:
        return "dev" if self.settings.PAYMENT_PROVIDER == "dev" else "cashfree"

    def _active(self) -> PaymentGateway | None:
        if self.settings.PAYMENT_PROVIDER == "dev":
            return self._dev  # None outside local/development/test: the dev provider is refused
        return self._cashfree

    def current(self) -> PaymentGateway:
        """Gateway for new orders; 501 ``payments_not_configured`` when there is none."""
        gw = self._active()
        if gw is None:
            raise PaymentsNotConfigured()
        return gw

    def for_provider(self, provider: str) -> PaymentGateway:
        if provider == "dev":
            if self._dev is None:
                raise PaymentsNotConfigured()
            return self._dev
        if self._cashfree is None:
            raise PaymentsNotConfigured()
        return self._cashfree

    @property
    def cashfree(self) -> CashfreeGateway | None:
        return self._cashfree

    @property
    def dev(self) -> DevGateway | None:
        return self._dev

    def webhook_secret(self) -> str | None:
        """The Cashfree secret, only when the Cashfree client is configured (else 501)."""
        secret = self.settings.CASHFREE_SECRET_KEY
        return secret.get_secret_value() if self._cashfree is not None and secret else None


_registry: GatewayRegistry | None = None


def get_gateways() -> GatewayRegistry:
    """FastAPI dependency / service accessor. Tests override it via ``app.dependency_overrides``."""
    global _registry
    if _registry is None:
        _registry = GatewayRegistry(get_payment_settings())
    return _registry


def reset_gateways() -> None:
    """Forget the cached registry (tests, settings reload)."""
    global _registry
    _registry = None
